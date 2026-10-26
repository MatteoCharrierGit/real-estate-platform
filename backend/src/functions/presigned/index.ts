import { S3Client } from "@aws-sdk/client-s3";
import { createDb } from "../../shared/db";
import { createApiHandler } from "../../shared/http";
import { createRoutes } from "./routes";

export const handler = createApiHandler(
  createRoutes({ db: createDb(), s3: new S3Client({}), bucket: process.env.FILES_BUCKET ?? "" }),
);
