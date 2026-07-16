/**
 * Registre éphémère des événements clonés par un contrôle superposé puis retransmis au canvas.
 * OrbitControls doit les recevoir, mais les autres interactions du canvas (comme le picker 3D)
 * ne doivent pas les confondre avec un geste commencé directement sur la scène.
 */
const forwardedControlEvents = new WeakSet<Event>();

export function markForwardedControlEvent<T extends Event>(event: T): T {
  forwardedControlEvents.add(event);
  return event;
}

export function isForwardedControlEvent(event: Event): boolean {
  return forwardedControlEvents.has(event);
}
