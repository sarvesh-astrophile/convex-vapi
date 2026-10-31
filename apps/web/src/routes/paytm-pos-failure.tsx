import { createFileRoute } from "@tanstack/react-router";

import PaymentConfidenceDemo from "@/components/paytm-pos/payment-confidence-demo";

export const Route = createFileRoute("/paytm-pos-failure")({
  component: PaytmPosFailurePage,
  head: () => ({
    meta: [
      { title: "Paytm POS · Payment confidence" },
      {
        name: "description",
        content:
          "Interactive Paytm POS concept for handling an expired payment QR without losing the sale.",
      },
    ],
  }),
});

function PaytmPosFailurePage() {
  return <PaymentConfidenceDemo />;
}
