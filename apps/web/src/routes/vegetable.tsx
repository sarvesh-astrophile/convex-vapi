import { createFileRoute } from "@tanstack/react-router";

import VegetableSlideshow from "@/components/vegetable-slideshow";

export const Route = createFileRoute("/vegetable")({
  component: VegetablePage,
  head: () => ({
    meta: [
      { title: "Vegetable · Slideshow" },
      {
        name: "description",
        content:
          "A slideshow of the vegetable vendor flow: the vendor's challenge, asking Paytm, analysing past sales, location recommendations, and a successful business day.",
      },
    ],
  }),
});

function VegetablePage() {
  return <VegetableSlideshow />;
}
