// Trigger Cognito "Post confirmation" (solo per il deploy di prova, non fa parte dell'architettura documentata).
// Alla conferma della registrazione mette l'utente in un gruppo: AGENT_EMAILS -> "agent", tutti gli altri -> DEFAULT_GROUP.
// Così chi si registra può subito fare offerte senza che qualcuno lo aggiunga a mano da console.
import { AdminAddUserToGroupCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({});
const agentEmails = (process.env.AGENT_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const defaultGroup = process.env.DEFAULT_GROUP || "buyer";

export const handler = async (event) => {
  // Lo stesso trigger scatta anche dopo il reset della password: lì il gruppo c'è già.
  if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") return event;

  const email = (event.request.userAttributes.email ?? "").toLowerCase();
  const group = agentEmails.includes(email) ? "agent" : defaultGroup;
  try {
    await cognito.send(
      new AdminAddUserToGroupCommand({ UserPoolId: event.userPoolId, Username: event.userName, GroupName: group }),
    );
    console.log(JSON.stringify({ level: "INFO", code: "GROUP_ASSIGNED", group }));
  } catch (err) {
    // Non si blocca la registrazione: nel caso peggiore il gruppo si assegna a mano da console.
    console.log(JSON.stringify({ level: "ERROR", code: "GROUP_ASSIGN_FAILED", group, error: err?.name }));
  }
  return event;
};
