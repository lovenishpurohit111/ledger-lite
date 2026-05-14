from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from fastapi import UploadFile

from backend.app.services.pipeline import ConversionPipeline


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    storage = Path("backend/app/storage/telegram-actions")
    pipeline = ConversionPipeline(storage)

    with input_path.open("rb") as handle:
        upload = UploadFile(file=handle, filename=input_path.name)
        result = await pipeline.run([upload])

    workbook = pipeline.workbook_path(result.job_id)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(workbook.read_bytes())


if __name__ == "__main__":
    asyncio.run(main())
