import type React from "react";

// Phones and tablets: focusing a field pops up the keyboard over the list, so filter boxes there
// wait for a tap instead of focusing themselves, and Enter puts the keyboard away.
export const isTouch = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
export const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur(); };
