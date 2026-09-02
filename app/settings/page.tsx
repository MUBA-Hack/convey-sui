import type { Metadata } from "next";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";

export const metadata: Metadata = { title: "Settings | Convey", description: "Manage Convey payment, QR, privacy, and notification preferences." };

export default function SettingsPage() { return <SettingsWorkspace />; }
