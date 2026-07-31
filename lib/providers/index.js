import * as twelveData from "./twelve-data";
const providers={"twelve-data":twelveData};
export function getProvider(name=process.env.GOLD_PULSE_DATA_PROVIDER||"twelve-data") {
  const provider=providers[name]; if(!provider) throw new Error(`Unknown data provider: ${name}`); return provider;
}
export function listProviders(){ return Object.keys(providers); }
