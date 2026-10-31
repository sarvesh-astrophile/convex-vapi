/**
 * Vapi assistants used by browser voice surfaces. Assistant definitions live in
 * Vapi; this file only pins the ones the app needs at build time.
 */
export const PAYTM_HELP_ASSISTANT_ID = "9df849b1-22a2-456b-b08e-e32aeaa26786";
export const PAYTM_HELP_ASSISTANT_NAME = "Paytm POS Payment Care";

export type VapiAssistantOption = {
  id: string;
  name: string;
};
