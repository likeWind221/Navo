import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopResourceApi, DesktopResourceEvent, DesktopResourceFailure } from "../../../../shared/resource.js";
import { parentPath, type ResourceLibraryState } from "./model.js";
import { createPendingFollowEvents } from "./follow.js";

export interface ResourceLibraryModel extends ResourceLibraryState {
  openDirectory(path: string | null): void;
  goUp(): void;
  retry(): void;
  select(resourceId: string | null): void;
}

export function useResourceLibrary(api: DesktopResourceApi, projectId: string): ResourceLibraryModel {
  const [path, setPath] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState<ResourceLibraryState>(() => ({
    projectId, path: null, snapshot: null, status: "loading", failure: null, selected: null,
  }));
  const selectedId = useRef<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    selectedId.current = null;
    setState({ projectId, path, snapshot: null, status: "loading", failure: null, selected: null });
  }, [projectId, path, retryKey]);

  useEffect(() => {
    let disposed = false;
    let terminal = false;
    const generation = ++generationRef.current;
    let subscriptionId: string | null = null;
    const pendingEvents = createPendingFollowEvents();
    const setFailure = (failure: DesktopResourceFailure): void => {
      terminal = true;
      setState(previous => ({ ...previous, status: "failed", failure }));
    };

    const applyEvent = (event: Extract<DesktopResourceEvent, { type: "library-snapshot" | "stream-error" }>): void => {
      if (event.type === "library-snapshot") {
        if (event.snapshot.projectId !== projectId || event.snapshot.path !== path) return;
        subscriptionId = event.subscriptionId;
        selectedId.current = selectedId.current && event.snapshot.resources.some(item => item.resourceId === selectedId.current)
          ? selectedId.current : null;
        setState(previous => ({
          ...previous,
          projectId,
          path,
          snapshot: event.snapshot,
          status: "ready",
          failure: null,
          selected: selectedId.current === null ? null : event.snapshot.resources.find(item => item.resourceId === selectedId.current) ?? null,
        }));
      } else if (event.type === "stream-error") {
        setFailure(event.failure);
      }
    };

    const removeListener = api.onEvent(event => {
      if (disposed || terminal || (event.type !== "library-snapshot" && event.type !== "stream-error")) return;
      if (subscriptionId !== null) {
        if (event.subscriptionId === subscriptionId) applyEvent(event);
        return;
      }
      if (event.type === "library-snapshot" && (event.snapshot.projectId !== projectId || event.snapshot.path !== path)) return;
      pendingEvents.add(event, projectId, path);
    });
    void api.startFollow({ projectId, path }).then(result => {
      if (result.type === "failed") {
        pendingEvents.clear();
        removeListener();
        if (!disposed && !terminal) setFailure(result.failure);
        return;
      }
      if (disposed || terminal || generationRef.current !== generation) {
        void api.cancel(result.value.subscriptionId);
        return;
      }
      subscriptionId = result.value.subscriptionId;
      const earlyEvents = pendingEvents.take(subscriptionId);
      pendingEvents.clear();
      if (!terminal) earlyEvents.forEach(applyEvent);
    });
    return () => {
      disposed = true;
      removeListener();
      pendingEvents.clear();
      if (subscriptionId !== null) void api.cancel(subscriptionId);
    };
  }, [api, projectId, path, retryKey]);

  const openDirectory = useCallback((nextPath: string | null) => { setPath(nextPath); }, []);
  const goUp = useCallback(() => {
    setPath(parentPath);
  }, []);
  const retry = useCallback(() => { setRetryKey(value => value + 1); }, []);
  const select = useCallback((resourceId: string | null) => {
    selectedId.current = resourceId;
    setState(previous => ({
      ...previous,
      selected: resourceId === null ? null : previous.snapshot?.resources.find(item => item.resourceId === resourceId) ?? null,
    }));
  }, []);
  return { ...state, openDirectory, goUp, retry, select };
}
