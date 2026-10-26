import { S3Client } from "@aws-sdk/client-s3";
import { createDb } from "../../shared/db";
import { createApiHandler } from "../../shared/http";
import { createRoutes } from "./routes";

// Tutto fuori dall'handler: pool, client S3 e router sopravvivono tra le invocazioni "calde".
const routes = createRoutes({ db: createDb(), s3: new S3Client({}), bucket: process.env.FILES_BUCKET ?? "" });
export const handler = createApiHandler(routes);
