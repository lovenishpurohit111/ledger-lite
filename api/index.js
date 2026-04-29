import serverless from "serverless-http";
import { createApp } from "./app.js";

export default serverless(createApp());
