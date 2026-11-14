// Schema-aligned types. Replace with Supabase CLI introspection after applying the migration.
import type { Farm, Season, Crop, Observation, Scenario } from "./types";
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
type Dates = { created_at: string; updated_at: string };
type Profile = {
  id: string;
  full_name: string;
  country: string;
  region: string;
  country_code: string | null;
  location_id: string | null;
  latitude: number | null;
  longitude: number | null;
} & Dates;
type FieldRow = {
  id: string;
  farm_id: string;
  name: string;
  boundary: unknown;
  area_hectares: number;
  soil_type: string;
  irrigation_type: string;
} & Dates;
type Table<Row, Insert = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Row>;
  Relationships: [];
};
export interface Database {
  public: {
    Tables: {
      profiles: Table<Profile>;
      farms: Table<Farm & Dates>;
      fields: Table<FieldRow>;
      crops: Table<Crop>;
      field_seasons: Table<Season>;
      climate_observations: Table<
        Observation & {
          id: string;
          field_id: string;
          source: string;
          retrieved_at: string;
        }
      >;
      analysis_results: Table<{
        id: string;
        field_id: string;
        analysis_type: string;
        result: Json;
        source_metadata: Json;
        created_at: string;
      }>;
      rotation_scenarios: Table<Scenario & { id: string; created_at: string }>;
    };
    Views: { field_geojson: { Row: FieldRow; Relationships: [] } };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
