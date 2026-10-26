import { S3Client } from "@aws-sdk/client-s3";
import type { S3Event } from "aws-lambda";
import { createDb } from "../../shared/db";
import { createApiHandler, type ApiEvent, type HttpResult } from "../../shared/http";
import { isS3Event, registerAll } from "./register";
import { createRoutes } from "./routes";

const db = createDb();
const s3 = new S3Client({});
const bucket = process.env.FILES_BUCKET ?? "";
const api = createApiHandler(createRoutes({ db, s3, bucket }));

export const handler = async (event: S3Event | ApiEvent): Promise<HttpResult | void> => {
  if (isS3Event(event)) return registerAll(db, s3, bucket, event);
  return api(event as ApiEvent);
};
