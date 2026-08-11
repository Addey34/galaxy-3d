import { describe, expect, it, vi } from 'vitest';
import { setupOverlayCoordinator } from './overlayCoordinator';

describe('overlay coordinator', () => {
  it('closes every other contextual surface before opening one', () => {
    const coordinator = setupOverlayCoordinator();
    const closeInfo = vi.fn();
    const closeSettings = vi.fn();
    const closeEvents = vi.fn();
    coordinator.register('body-info', closeInfo);
    coordinator.register('orbit-options', closeSettings);
    coordinator.register('events', closeEvents);

    coordinator.requestOpen('orbit-options');

    expect(closeInfo).toHaveBeenCalledOnce();
    expect(closeSettings).not.toHaveBeenCalled();
    expect(closeEvents).toHaveBeenCalledOnce();
  });

  it('notifies persistent surfaces when contextual content opens', () => {
    const coordinator = setupOverlayCoordinator();
    const listener = vi.fn();
    coordinator.onOpen(listener);

    coordinator.requestOpen('help');

    expect(listener).toHaveBeenCalledWith('help');
  });
});
