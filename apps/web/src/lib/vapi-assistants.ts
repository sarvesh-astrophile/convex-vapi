/**
 * Vapi assistants used by browser voice surfaces. Assistant definitions live in
 * Vapi; this file only pins the ones the app needs at build time.
 */
export const PAYTM_HELP_ASSISTANT_ID = "9df849b1-22a2-456b-b08e-e32aeaa26786";
export const PAYTM_HELP_ASSISTANT_NAME = "Paytm POS Payment Care";

/** Used by the `/auto` slideshow's end-of-slide-4 voice demo. */
export const PAYTM_AUTO_ADVISOR_ASSISTANT_ID = "55984355-cfe8-4799-9743-db19a6c5fd12";
export const PAYTM_AUTO_ADVISOR_ASSISTANT_NAME = "Paytm Auto Opportunity Advisor";

/** Used by the `/sales-dip` slideshow's end-of-slide-5 voice demo. */
export const PAYTM_SALES_DIP_ASSISTANT_ID = "a575b96d-ee4d-43a9-ae0d-83e6282bfb54";
export const PAYTM_SALES_DIP_ASSISTANT_NAME = "Paytm POS Sales Dip Advisor";

/** Used by the `/vegetable` slideshow's end-of-slide-4 voice demo. */
export const PAYTM_VEGETABLE_ADVISOR_ASSISTANT_ID = "2dc8aa59-266b-40a2-a0b9-e52deb6fb581";
export const PAYTM_VEGETABLE_ADVISOR_ASSISTANT_NAME = "Paytm POS Location Advisor";

export type VapiAssistantOption = {
  id: string;
  name: string;
};
