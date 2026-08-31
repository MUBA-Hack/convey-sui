"use client";

import { useState } from "react";
import { loadActivity } from "@/lib/activity/storage";
import { ActivityEmpty } from "./activity-empty";
import { ActivityList } from "./activity-list";

/**
 * No-query /proof surface. Loads device-local convenience history through the
 * Activity storage API. Local records never upgrade proof; opening an item
 * reuses the existing receipt URL and verifier.
 *
 * Lazy client state: this panel mounts only after ProofVerifier finishes URL
 * inspection on the client, so `loadActivity` runs in the state initializer
 * and never as a synchronous effect update.
 */
export function ActivityPanel() {
  const [items] = useState(loadActivity);
  return items.length === 0 ? <ActivityEmpty /> : <ActivityList items={items} />;
}
