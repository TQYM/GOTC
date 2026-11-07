import type { Metadata } from "next";
import SandboxView from "./SandboxView";

export const metadata: Metadata = { title: "3D 沙盘预览 · CITY20" };

export default function SandboxPage() {
  return <SandboxView />;
}
