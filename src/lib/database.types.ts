export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      entry_photos: {
        Row: {
          created_at: string;
          entry_id: string;
          id: string;
          storage_path: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          entry_id: string;
          id: string;
          storage_path: string;
        };
        Update: {
          created_at?: string;
          entry_id?: string;
          id?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "entry_photos_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "scouting_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          city: string | null;
          country: string | null;
          created_at: string;
          end_date: string | null;
          key: string;
          name: string;
          start_date: string | null;
          state_prov: string | null;
          updated_at: string;
          year: number;
        };
        ComputedFields: never;
        Insert: {
          city?: string | null;
          country?: string | null;
          created_at?: string;
          end_date?: string | null;
          key: string;
          name: string;
          start_date?: string | null;
          state_prov?: string | null;
          updated_at?: string;
          year: number;
        };
        Update: {
          city?: string | null;
          country?: string | null;
          created_at?: string;
          end_date?: string | null;
          key?: string;
          name?: string;
          start_date?: string | null;
          state_prov?: string | null;
          updated_at?: string;
          year?: number;
        };
        Relationships: [];
      };
      field_definitions: {
        Row: {
          archived: boolean;
          bad_threshold: number | null;
          created_at: string;
          good_answer: boolean | null;
          good_threshold: number | null;
          higher_is_better: boolean | null;
          id: string;
          name: string;
          options: Json | null;
          section: string;
          sort_order: number;
          type: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          archived?: boolean;
          bad_threshold?: number | null;
          created_at?: string;
          good_answer?: boolean | null;
          good_threshold?: number | null;
          higher_is_better?: boolean | null;
          id?: string;
          name: string;
          options?: Json | null;
          section: string;
          sort_order?: number;
          type: string;
          updated_at?: string;
        };
        Update: {
          archived?: boolean;
          bad_threshold?: number | null;
          created_at?: string;
          good_answer?: boolean | null;
          good_threshold?: number | null;
          higher_is_better?: boolean | null;
          id?: string;
          name?: string;
          options?: Json | null;
          section?: string;
          sort_order?: number;
          type?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      scouting_entries: {
        Row: {
          answers: NonNullable<Json>;
          created_at: string;
          created_by: string | null;
          event_key: string;
          id: string;
          notes: string | null;
          rating: number | null;
          scouted_by: string | null;
          team_number: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          answers?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          event_key: string;
          id: string;
          notes?: string | null;
          rating?: number | null;
          scouted_by?: string | null;
          team_number: number;
          updated_at?: string;
        };
        Update: {
          answers?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          event_key?: string;
          id?: string;
          notes?: string | null;
          rating?: number | null;
          scouted_by?: string | null;
          team_number?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scouting_entries_event_key_fkey";
            columns: ["event_key"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["key"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      upsert_scouting_entry: {
        Args: {
          p_answers: Json;
          p_created_at: string;
          p_event_key: string;
          p_id: string;
          p_notes: string;
          p_rating: number;
          p_scouted_by: string;
          p_team_number: number;
          p_updated_at: string;
        };
        Returns: {
          answers: NonNullable<Json>;
          created_at: string;
          created_by: string | null;
          event_key: string;
          id: string;
          notes: string | null;
          rating: number | null;
          scouted_by: string | null;
          team_number: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "scouting_entries";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
