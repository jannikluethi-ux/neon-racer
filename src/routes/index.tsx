import { createFileRoute } from "@tanstack/react-router";
import { NeonRacer } from "@/components/neon-racer";

export const Route = createFileRoute("/")({ component: NeonRacer });
