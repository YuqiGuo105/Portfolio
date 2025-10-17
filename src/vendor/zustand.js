'use client';

import { useRef, useSyncExternalStore } from 'react';

const defaultEqualityFn = (a, b) => a === b;

export default function create(createState) {
  if (typeof createState !== 'function') {
    throw new Error('zustand-lite: create state creator must be a function.');
  }

  let state;
  const listeners = new Set();

  const setState = (partial, replace) => {
    const nextState =
      typeof partial === 'function' ? partial(state) : partial;
    if (nextState === state) return;

    const merged = replace ? nextState : { ...state, ...nextState };
    state = merged;
    listeners.forEach((listener) => listener());
  };

  const getState = () => state;

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const api = { setState, getState, subscribe };
  state = createState(setState, getState, api);

  const useStore = (selector = (s) => s, equalityFn = defaultEqualityFn) => {
    const sliceRef = useRef(selector(state));
    return useSyncExternalStore(
      subscribe,
      () => {
        const nextSlice = selector(getState());
        if (!equalityFn(sliceRef.current, nextSlice)) {
          sliceRef.current = nextSlice;
        }
        return sliceRef.current;
      },
      () => selector(state)
    );
  };

  useStore.setState = setState;
  useStore.getState = getState;
  useStore.subscribe = subscribe;

  return useStore;
}

export const createStore = create;
