'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

interface CommodityContextType {
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
  const [selectedCommodity, setSelectedCommodity] = useState('Tomatoes'); // Default to first of 6 key vegetables: Tomatoes, Lettuce, Onions, Potatoes, Carrots, Bell Peppers
  const [selectedState, setSelectedState] = useState('CA');
  const [selectedZipCode, setSelectedZipCode] = useState('90210');

  return (
    <CommodityContext.Provider
      value={{
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
