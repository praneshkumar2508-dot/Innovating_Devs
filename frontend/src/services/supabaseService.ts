import { supabase } from '../supabaseClient';
import type { InfraNode } from '../types';

/**
 * Fetches recent telemetry from Supabase for a given set of nodes.
 * Fallback to mock data if no Supabase connection is established.
 */
export const fetchTelemetryForNodes = async (nodes: InfraNode[]) => {
  try {
    const substationIds = nodes.filter(n => n.sector === 'POWER').map(n => n.id);
    
    // Example: fetch recent substation telemetry
    const { data: subData, error } = await supabase
      .from('telemetry_substation')
      .select('*')
      .in('node_id', substationIds)
      .order('timestamp', { ascending: false })
      .limit(10);
      
    if (error) {
      console.warn("Supabase fetch error, using local mock data:", error.message);
      return null;
    }
    
    return subData;
  } catch (err) {
    console.error("Supabase connection failed.", err);
    return null;
  }
};
