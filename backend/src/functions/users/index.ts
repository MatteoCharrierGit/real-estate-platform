import { createDb } from "../../shared/db";
import { createApiHandler } from "../../shared/http";
import { createPublisher } from "../../shared/sns";
import { createRoutes } from "./routes";

export const handler = createApiHandler(createRoutes({ db: createDb(), publish: createPublisher() }));
