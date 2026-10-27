'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getJSON } from '@/lib/api';
import type { Commodities } from '@/lib/types';

// The ten USDA vegetables the models are trained on, used until /commodities answers
const FALLBACK_COMMODITIES = ['Tomatoes', 'Lettuce', 'Carrots', 'Broccoli', 'Cucumbers', 'Cauliflower', 'Cabbage', 'Asparagus', 'Sweet Potatoes', 'Onions, Green'];

interface CommodityContextType {
  commodities: string[];
  /** Price unit suffix for a commodity, e.g. "/lb", " each", "/2 lb bag" */
  priceUnit: (commodity: string) => string;
  selectedCommodity: string;
  setSelectedCommodity: (commodity: string) => void;
  selectedState: string;
  setSelectedState: (state: string) => void;
  selectedZipCode: string;
  setSelectedZipCode: (zipCode: string) => void;
}

const CommodityContext = createContext<CommodityContextType | undefined>(undefined);

export const useCommodity = () => {
  const context = useContext(CommodityContext);
  if (context === undefined) {
    throw new Error('useCommodity must be used within a CommodityProvider');
  }
  return context;
};

interface CommodityProviderProps {
  children: ReactNode;
}

export const CommodityProvider: React.FC<CommodityProviderProps> = ({ children }) => {
  const [commodities, setCommodities] = useState<string[]>(FALLBACK_COMMODITIES);
  const [units, setUnits] = useState<Record<string, string>>({});
  const [selectedCommodity, setSelectedCommodity] = useState('Tomatoes');
  const [selectedState, setSelectedState] = useState('CA');
  const [selectedZipCode, setSelectedZipCode] = useState('90210');

  useEffect(() => {
    getJSON<Commodities>('/commodities')
      .then((data) => {
        if (data.viable_commodities?.length) setCommodities(data.viable_commodities);
        if (data.units) setUnits(data.units);
      })
      .catch(() => {});
  }, []);

  const priceUnit = (commodity: string) => {
    const unit = units[commodity];
    if (!unit) return '';
    return unit === 'each' ? ' each' : `/${unit.replace(/^per /, '')}`;
  };

  return (
    <CommodityContext.Provider
      value={{
        commodities,
        priceUnit,
        selectedCommodity,
        setSelectedCommodity,
        selectedState,
        setSelectedState,
        selectedZipCode,
        setSelectedZipCode,
      }}
    >
      {children}
    </CommodityContext.Provider>
  );
};
