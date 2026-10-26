import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { randomUUID } from "node:crypto";
import { errorInfo, log } from "./log";

export type EventType = "WELCOME" | "OFFER_CREATED" | "OFFER_ACCEPTED" | "OFFER_REJECTED" | "OFFER_WITHDRAWN";

/** Formato di sns.md: il destinatario è un `sub`, mai un'email. `data` porta solo ciò che serve al testo dell'email. */
export interface NotificationEvent {
  eventId: string;
  type: EventType;
  recipientSub: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export function buildEvent(
  type: EventType,
  recipientSub: string,
  data: Record<string, unknown> = {},
  now: Date = new Date(),
  eventId: string = randomUUID(),
): NotificationEvent {
  return { eventId, type, recipientSub, occurredAt: now.toISOString(), data };
}

/** Pubblica un evento e NON lancia mai: va chiamata dopo il COMMIT, e un'email persa non deve far fallire la richiesta. */
export type Publisher = (type: EventType, recipientSub: string, data?: Record<string, unknown>) => Promise<void>;

export function createPublisher(client: SNSClient = new SNSClient({}), topicArn = process.env.SNS_TOPIC_ARN): Publisher {
  return async (type, recipientSub, data = {}) => {
    const event = buildEvent(type, recipientSub, data);
    try {
      if (!topicArn) throw new Error("SNS_TOPIC_ARN non impostato");
      await client.send(new PublishCommand({ TopicArn: topicArn, Message: JSON.stringify(event) }));
    } catch (err) {
      // Solo eventId e tipo nel log: bastano a ricostruire il caso, senza dati personali.
      log("ERROR", "SNS_PUBLISH_FAILED", { eventId: event.eventId, type, ...errorInfo(err) });
    }
  };
}
