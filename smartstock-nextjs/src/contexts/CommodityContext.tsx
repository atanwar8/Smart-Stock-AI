'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { getJSON } from '@/lib/api';
import type { Commodities } from '@/lib/types';

// The ten USDA vegetables the models are trained on, used until /commodities answers
const FALLBACK_COMMODITIES = ['Tomatoes', 'Lettuce', 'Carrots', 'Broccoli', 'Cucumbers', 'Cauliflower', 'Cabbage', 'Asparagus', 'Sweet Potatoes', 'Onions, Green'];

interface CommodityState {
  commodities: string[];
  /** Price unit suffix for a commodity, e.g. "/lb", " each", "/2 lb bag" */
  priceUnit: (commodity: string) => string;
  selectedCommodity: string;
  selectedState: string;
  selectedZipCode: string;
}

interface CommodityActions {
  setSelectedCommodity: (commodity: string) => void;
  setSelectedState: (state: string) => void;
  setSelectedZipCode: (zipCode: string) => void;
}

type CommodityContextType = CommodityState & CommodityActions;

// Two contexts so controls that only change the selection (switcher, keyboard shortcuts) don't
// re-render every time the selection changes; the setters never change identity.
const StateContext = createContext<CommodityState | undefined>(undefined);
const ActionsContext = createContext<CommodityActions | undefined>(undefined);

const ZIP_KEY = 'smartstock.zip';

export function useCommodityState(): CommodityState {
  const context = useContext(StateContext);
  if (context === undefined) throw new Error('useCommodityState must be used within a CommodityProvider');
  return context;
}

export function useCommodityActions(): CommodityActions {
  const context = useContext(ActionsContext);
  if (context === undefined) throw new Error('useCommodityActions must be used within a CommodityProvider');
  return context;
}

/** Everything at once: { commodities, selectedCommodity, setSelectedCommodity, priceUnit, ... } */
export const useCommodity = (): CommodityContextType => {
  const state = useCommodityState();
  const actions = useCommodityActions();
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
};

interface CommodityProviderProps {
  children: ReactNode;
}

export const CommodityProvider: React.FC<CommodityProviderProps> = ({ children }) => {
  const [commodities, setCommodities] = useState<string[]>(FALLBACK_COMMODITIES);
  const [units, setUnits] = useState<Record<string, string>>({});
  const [selectedCommodity, setSelectedCommodity] = useState('Tomatoes');
  const [selectedState, setSelectedState] = useState('CA');
  const [selectedZipCode, setZip] = useState('90210');

  useEffect(() => {
    getJSON<Commodities>('/commodities')
      .then((data) => {
        if (data.viable_commodities?.length) setCommodities(data.viable_commodities);
        if (data.units) setUnits(data.units);
      })
      .catch(() => {});
  }, []);

  // The kitchen's ZIP is personal, so it survives a reload
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ZIP_KEY);
      if (saved && /^\d{5}$/.test(saved)) setZip(saved);
    } catch {}
  }, []);

  const setSelectedZipCode = useCallback((zip: string) => {
    setZip(zip);
    try {
      localStorage.setItem(ZIP_KEY, zip);
    } catch {}
  }, []);

  const priceUnit = useCallback(
    (commodity: string) => {
      const unit = units[commodity];
      if (!unit) return '';
      return unit === 'each' ? ' each' : `/${unit.replace(/^per /, '')}`;
    },
    [units]
  );

  const state = useMemo(
    () => ({ commodities, priceUnit, selectedCommodity, selectedState, selectedZipCode }),
    [commodities, priceUnit, selectedCommodity, selectedState, selectedZipCode]
  );
  const actions = useMemo(() => ({ setSelectedCommodity, setSelectedState, setSelectedZipCode }), [setSelectedZipCode]);

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
};
