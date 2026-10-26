import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { createHandler } from "./handler";

// Client creati fuori dall'handler e riusati. La Mailer sta fuori dalla VPC e non usa il database.
export const handler = createHandler({
  cognito: new CognitoIdentityProviderClient({}),
  ses: new SESv2Client({}),
  userPoolId: process.env.USER_POOL_ID ?? "",
  mailFrom: process.env.MAIL_FROM ?? "",
  siteUrl: process.env.SITE_URL ?? "",
});
