/**
 * Vapi assistants used by browser voice surfaces. Assistant definitions live in
 * Vapi; this file only pins the ones the app needs at build time.
 */
export const PAYTM_HELP_ASSISTANT_ID = "9df849b1-22a2-456b-b08e-e32aeaa26786";
export const PAYTM_HELP_ASSISTANT_NAME = "Paytm POS Payment Care";

/** Used by the `/auto` slideshow's end-of-slide-4 voice demo. */
export const PAYTM_AUTO_ADVISOR_ASSISTANT_ID = "55984355-cfe8-4799-9743-db19a6c5fd12";
export const PAYTM_AUTO_ADVISOR_ASSISTANT_NAME = "Paytm Auto Opportunity Advisor";

export type VapiAssistantOption = {
  id: string;
  name: string;
};
