import { cn } from "@convex-vapi/ui/lib/utils";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AutoAdvisorCall } from "@/components/auto-advisor-call";

const SLIDES = [
  { src: "/auto/Auto-1.png", alt: "Auto slide 1" },
  { src: "/auto/Auto-2.png", alt: "Auto slide 2" },
  { src: "/auto/Auto-3.png", alt: "Auto slide 3" },
  { src: "/auto/Auto-4.png", alt: "Auto slide 4" },
  { src: "/auto/auto-5.png", alt: "Auto slide 5" },
] as const;

const SLIDE_DURATION_MS = 5000;
/** Zero-based index of the suggestion slide that ends with the live call demo. */
const ADVISOR_SLIDE_INDEX = 3;

export default function AutoSlideshow() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [advisorOpen, setAdvisorOpen] = useState(false);

  const goTo = useCallback((next: number) => {
    setAdvisorOpen(false);
    setIndex(((next % SLIDES.length) + SLIDES.length) % SLIDES.length);
    setProgress(0);
  }, []);

  const openAdvisor = useCallback(() => {
    setAdvisorOpen(true);
    setPlaying(false);
    setProgress(1);
  }, []);

  const closeAdvisor = useCallback(() => {
    setAdvisorOpen(false);
    setIndex((current) => (current === ADVISOR_SLIDE_INDEX ? current + 1 : current));
    setProgress(0);
    setPlaying(true);
  }, []);

  const next = useCallback(() => {
    if (index === ADVISOR_SLIDE_INDEX) {
      openAdvisor();
      return;
    }
    goTo(index + 1);
  }, [goTo, index, openAdvisor]);

  const previous = useCallback(() => goTo(index - 1), [goTo, index]);

  useEffect(() => {
    if (!playing || advisorOpen) {
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= SLIDE_DURATION_MS) {
        if (index === ADVISOR_SLIDE_INDEX) {
          openAdvisor();
          return;
        }
        setIndex((current) => (current + 1) % SLIDES.length);
        setProgress(0);
        return;
      }
      setProgress(elapsed / SLIDE_DURATION_MS);
    }, 100);

    return () => window.clearInterval(timer);
  }, [playing, index, advisorOpen, openAdvisor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (advisorOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeAdvisor();
        }
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        previous();
      } else if (event.key === " ") {
        event.preventDefault();
        setPlaying((current) => !current);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advisorOpen, closeAdvisor, next, previous]);

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-4 px-4 py-4"
      aria-roledescription="carousel"
      aria-label="Auto slideshow"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-xl">Auto</h1>
          <p className="text-muted-foreground text-sm">
            Slide {index + 1} of {SLIDES.length}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPlaying((current) => !current)}
            disabled={advisorOpen}
            className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors hover:bg-accent disabled:opacity-50"
            aria-label={playing ? "Pause slideshow" : "Play slideshow"}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            {playing ? "Pause" : "Play"}
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border bg-muted/30">
        {SLIDES.map((slide, slideIndex) => (
          <img
            key={slide.src}
            src={slide.src}
            alt={slide.alt}
            aria-hidden={slideIndex !== index}
            className={cn(
              "absolute inset-0 m-auto max-h-full max-w-full object-contain p-4 transition-all duration-500 ease-out",
              slideIndex === index
                ? "scale-100 opacity-100"
                : "pointer-events-none scale-95 opacity-0",
            )}
          />
        ))}

        <button
          type="button"
          onClick={previous}
          aria-label="Previous slide"
          className="absolute top-1/2 left-3 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full border bg-background/80 backdrop-blur transition-colors hover:bg-accent"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          onClick={next}
          aria-label="Next slide"
          className="absolute top-1/2 right-3 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full border bg-background/80 backdrop-blur transition-colors hover:bg-accent"
        >
          <ChevronRight className="size-5" />
        </button>

        {advisorOpen ? <AutoAdvisorCall onClose={closeAdvisor} /> : null}
      </div>

      <div className="flex flex-col gap-3">
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-100 ease-linear"
            style={{ width: advisorOpen ? "100%" : playing ? `${progress * 100}%` : "0%" }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {SLIDES.map((slide, slideIndex) => (
            <button
              key={slide.src}
              type="button"
              onClick={() => goTo(slideIndex)}
              aria-label={`Go to slide ${slideIndex + 1}`}
              aria-current={slideIndex === index}
              className={cn(
                "h-14 w-20 overflow-hidden rounded-md border-2 bg-muted/30 p-1 transition-colors",
                slideIndex === index ? "border-primary" : "border-transparent hover:border-border",
              )}
            >
              <img
                src={slide.src}
                alt=""
                className="h-full w-full rounded-sm object-contain"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
