import { createFileRoute } from "@tanstack/react-router";

import AutoSlideshow from "@/components/auto-slideshow";

export const Route = createFileRoute("/auto")({
  component: AutoPage,
  head: () => ({
    meta: [
      { title: "Auto · Slideshow" },
      {
        name: "description",
        content: "A slideshow of the Auto screenshots.",
      },
    ],
  }),
});

function AutoPage() {
  return <AutoSlideshow />;
}
