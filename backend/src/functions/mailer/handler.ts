import { AdminGetUserCommand, type CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { SendEmailCommand, type SESv2Client } from "@aws-sdk/client-sesv2";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { log } from "../../shared/log";
import { classifyError, parseEvent, PermanentError } from "./events";
import { render } from "./templates";

export interface MailerDeps {
  cognito: Pick<CognitoIdentityProviderClient, "send">;
  ses: Pick<SESv2Client, "send">;
  userPoolId: string;
  mailFrom: string;
  siteUrl: string;
}

export function createHandler(deps: MailerDeps) {
  async function processRecord(record: SQSRecord): Promise<void> {
    const event = parseEvent(record.body);

    // L'email non sta nel database né nell'evento: si chiede a Cognito (Username = sub, vale perché il pool
    // usa l'email come attributo di accesso).
    const user = await deps.cognito.send(new AdminGetUserCommand({ UserPoolId: deps.userPoolId, Username: event.recipientSub }));
    const attr = Object.fromEntries((user.UserAttributes ?? []).map((a) => [a.Name, a.Value]));
    if (attr.email_verified !== "true" || !attr.email) throw new PermanentError("email non verificata");

    const { subject, text, html } = render(event, deps.siteUrl);
    await deps.ses.send(
      new SendEmailCommand({
        FromEmailAddress: deps.mailFrom,
        Destination: { ToAddresses: [attr.email] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: { Text: { Data: text, Charset: "UTF-8" }, Html: { Data: html, Charset: "UTF-8" } },
          },
        },
      }),
    );
    log("INFO", "MAIL_SENT", { messageId: record.messageId, eventId: event.eventId, type: event.type });
  }

  /** Non lancia mai: un'eccezione farebbe ritentare TUTTO il batch (email doppie). Restituisce solo i messaggi da ritentare. */
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      try {
        await processRecord(record);
      } catch (err) {
        // Nei log: messageId e nome dell'errore, MAI il messaggio dell'errore (quello di SES può contenere l'indirizzo email).
        const name = (err as { name?: string }).name ?? "Error";
        switch (classifyError(err)) {
          case "recipient-deleted":
            log("INFO", "RECIPIENT_DELETED", { messageId: record.messageId, error: name });
            break;
          case "permanent":
            // Esattamente ciò che cerca il metric filter: level = ERROR e code = MAIL_PERMANENT_FAILURE.
            log("ERROR", "MAIL_PERMANENT_FAILURE", {
              messageId: record.messageId,
              error: name,
              ...(err instanceof PermanentError ? { reason: err.message } : {}),
            });
            break;
          case "temporary":
            log("WARN", "MAIL_RETRY", { messageId: record.messageId, error: name });
            batchItemFailures.push({ itemIdentifier: record.messageId });
            break;
        }
      }
    }
    return { batchItemFailures };
  };
}
