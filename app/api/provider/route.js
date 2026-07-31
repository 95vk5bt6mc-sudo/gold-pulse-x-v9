import { NextResponse } from "next/server";
import { listProviders } from "../../../lib/providers";
export const dynamic="force-dynamic";
export async function GET(){ return NextResponse.json({ok:true,active:process.env.GOLD_PULSE_DATA_PROVIDER||"twelve-data",available:listProviders(),fallback:false,note:"Twelve Data remains the default; additional providers can be added without changing the dashboard."}); }
