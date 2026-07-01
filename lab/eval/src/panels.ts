// Minimal type stub (ACS eval only needs ConversationTurn from the ported agentRunner).
export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}
