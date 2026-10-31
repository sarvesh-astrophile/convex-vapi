import { cn } from "@convex-vapi/ui/lib/utils";
import { ChevronLeft, ChevronRight, Pause, Phone, Play } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";

import { VegetableCall } from "@/components/vegetable-call";

const SLIDES = [
  {
    src: "/vegetable/01_vendor_challenge.png",
    title: "Vendor challenge",
    alt: "Slide 1: The vendor challenge",
  },
  {
    src: "/vegetable/02_asking_paytm.png",
    title: "Asking Paytm",
    alt: "Slide 2: Asking Paytm for help",
  },
  {
    src: "/vegetable/03_analysing_past_sales.png",
    title: "Analysing past sales",
    alt: "Slide 3: Analysing past sales",
  },
  {
    src: "/vegetable/04_top_location_recommendation.png",
    title: "Top location recommendation",
    alt: "Slide 4: Top location recommendation",
  },
  {
    src: "/vegetable/05_successful_business_day.png",
    title: "Successful business day",
    alt: "Slide 5: A successful business day",
  },
] as const;

const SLIDE_DURATION_MS = 5000;
/** Zero-based index of the slide that ends with the live location-advisor demo. */
const CALL_SLIDE_INDEX = 1;

export default function VegetableSlideshow() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [callOpen, setCallOpen] = useState(false);

  const goTo = useCallback((next: number) => {
    setCallOpen(false);
    setIndex(((next % SLIDES.length) + SLIDES.length) % SLIDES.length);
    setProgress(0);
  }, []);

  const openCall = useCallback(() => {
    setCallOpen(true);
    setPlaying(false);
    setProgress(1);
  }, []);

  const closeCall = useCallback(() => {
    setCallOpen(false);
    setIndex((current) => (current === CALL_SLIDE_INDEX ? current + 1 : current));
    setProgress(0);
    setPlaying(true);
  }, []);

  const next = useCallback(() => {
    if (index === CALL_SLIDE_INDEX) {
      openCall();
      return;
    }
    goTo(index + 1);
  }, [goTo, index, openCall]);

  const previous = useCallback(() => goTo(index - 1), [goTo, index]);

  useEffect(() => {
    if (!playing || callOpen) {
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= SLIDE_DURATION_MS) {
        if (index === CALL_SLIDE_INDEX) {
          openCall();
          return;
        }
        setIndex((current) => (current + 1) % SLIDES.length);
        setProgress(0);
        return;
      }
      setProgress(elapsed / SLIDE_DURATION_MS);
    }, 100);

    return () => window.clearInterval(timer);
  }, [playing, index, callOpen, openCall]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (callOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeCall();
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
  }, [callOpen, closeCall, next, previous]);

  const slide = SLIDES[index];

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-4 px-4 py-4"
      aria-roledescription="carousel"
      aria-label="Vegetable slideshow"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-xl">Vegetable</h1>
          <p className="text-muted-foreground text-sm">
            Slide {index + 1} of {SLIDES.length} · {slide.title}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPlaying((current) => !current)}
            className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors hover:bg-accent"
            aria-label={playing ? "Pause slideshow" : "Play slideshow"}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            {playing ? "Pause" : "Play"}
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border bg-muted/30">
        {SLIDES.map((item, slideIndex) => (
          <img
            key={item.src}
            src={item.src}
            alt={item.alt}
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

        {callOpen ? <VegetableCall onClose={closeCall} /> : null}
      </div>

      <div className="flex flex-col gap-3">
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-100 ease-linear"
            style={{ width: callOpen ? "100%" : playing ? `${progress * 100}%` : "0%" }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {SLIDES.map((item, slideIndex) => (
            <Fragment key={item.src}>
              {slideIndex === CALL_SLIDE_INDEX + 1 ? (
                <button
                  type="button"
                  onClick={openCall}
                  aria-label="Open the location advisor call demo"
                  aria-pressed={callOpen}
                  className={cn(
                    "flex h-14 w-20 flex-col items-center justify-center gap-1 rounded-md border-2 bg-muted/30 text-muted-foreground transition-colors hover:border-border hover:text-foreground",
                    callOpen ? "border-primary text-foreground" : "border-transparent",
                  )}
                >
                  <Phone className="size-4" />
                  <span className="font-medium text-[10px] leading-none">Call</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => goTo(slideIndex)}
                aria-label={`Go to slide ${slideIndex + 1}: ${item.title}`}
                aria-current={slideIndex === index}
                className={cn(
                  "h-14 w-20 overflow-hidden rounded-md border-2 bg-muted/30 p-1 transition-colors",
                  slideIndex === index
                    ? "border-primary"
                    : "border-transparent hover:border-border",
                )}
              >
                <img
                  src={item.src}
                  alt=""
                  className="h-full w-full rounded-sm object-contain"
                  loading="lazy"
                />
              </button>
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
