from __future__ import annotations

from pathlib import Path
from typing import Iterable


class PreprocessingService:
    """Prepares image/PDF inputs for OCR while keeping native dependencies optional."""

    def preprocess_files(self, paths: Iterable[Path], output_dir: Path) -> list[Path]:
        output_dir.mkdir(parents=True, exist_ok=True)
        pages: list[Path] = []
        for path in paths:
            if path.suffix.lower() == ".pdf":
                pages.extend(self._preprocess_pdf(path, output_dir))
            else:
                pages.append(self._preprocess_image(path, output_dir))
        return pages

    def _preprocess_pdf(self, path: Path, output_dir: Path) -> list[Path]:
        try:
            from pdf2image import convert_from_path
        except Exception:
            return [path]

        pages: list[Path] = []
        for index, image in enumerate(convert_from_path(str(path), dpi=240), start=1):
            image_path = output_dir / f"{path.stem}-page-{index}.png"
            image.save(image_path)
            pages.append(self._preprocess_image(image_path, output_dir))
        return pages

    def _preprocess_image(self, path: Path, output_dir: Path) -> Path:
        try:
            import cv2
            import numpy as np
        except Exception:
            return path

        image = cv2.imread(str(path))
        if image is None:
            return path

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        gray = cv2.fastNlMeansDenoising(gray, None, 12, 7, 21)
        gray = self._deskew(gray, cv2, np)
        gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
        sharpened = cv2.filter2D(gray, -1, np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]]))
        corrected = self._correct_page_boundary(sharpened, cv2, np)
        output_path = output_dir / f"{path.stem}-clean.png"
        cv2.imwrite(str(output_path), corrected)
        return output_path

    def _deskew(self, gray, cv2, np):
        coords = np.column_stack(np.where(gray < 245))
        if len(coords) < 100:
            return gray
        angle = cv2.minAreaRect(coords)[-1]
        if angle < -45:
            angle = -(90 + angle)
        else:
            angle = -angle
        if abs(angle) < 0.3:
            return gray
        height, width = gray.shape[:2]
        matrix = cv2.getRotationMatrix2D((width // 2, height // 2), angle, 1.0)
        return cv2.warpAffine(gray, matrix, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)

    def _correct_page_boundary(self, gray, cv2, np):
        edges = cv2.Canny(gray, 80, 200)
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return gray
        contour = max(contours, key=cv2.contourArea)
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approx) != 4 or cv2.contourArea(approx) < gray.shape[0] * gray.shape[1] * 0.2:
            return gray
        points = approx.reshape(4, 2).astype("float32")
        ordered = self._order_points(points, np)
        width = int(max(np.linalg.norm(ordered[2] - ordered[3]), np.linalg.norm(ordered[1] - ordered[0])))
        height = int(max(np.linalg.norm(ordered[1] - ordered[2]), np.linalg.norm(ordered[0] - ordered[3])))
        target = np.array([[0, 0], [0, height - 1], [width - 1, height - 1], [width - 1, 0]], dtype="float32")
        transform = cv2.getPerspectiveTransform(ordered, target)
        return cv2.warpPerspective(gray, transform, (width, height))

    def _order_points(self, points, np):
        rect = np.zeros((4, 2), dtype="float32")
        summed = points.sum(axis=1)
        diff = np.diff(points, axis=1)
        rect[0] = points[np.argmin(summed)]
        rect[2] = points[np.argmax(summed)]
        rect[1] = points[np.argmin(diff)]
        rect[3] = points[np.argmax(diff)]
        return rect
