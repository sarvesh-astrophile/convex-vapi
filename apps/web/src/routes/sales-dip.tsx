import { createFileRoute } from "@tanstack/react-router";

import SalesDipSlideshow from "@/components/sales-dip-slideshow";

export const Route = createFileRoute("/sales-dip")({
  component: SalesDipPage,
  head: () => ({
    meta: [
      { title: "Sales dip · Slideshow" },
      {
        name: "description",
        content:
          "A slideshow of the sales dip flow: identify the dip, notify the merchant, share insights, and help them take action.",
      },
    ],
  }),
});

function SalesDipPage() {
  return <SalesDipSlideshow />;
}
