export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      members: {
        Row: {
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          is_active: boolean;
          role: Database["public"]["Enums"]["app_role"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          email: string;
          full_name: string;
          id?: string;
          is_active?: boolean;
          role: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          is_active?: boolean;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
        };
        Relationships: [];
      };
      vessel_assignments: {
        Row: {
          assigned_at: string;
          member_id: string;
          vessel_id: string;
        };
        ComputedFields: never;
        Insert: {
          assigned_at?: string;
          member_id: string;
          vessel_id: string;
        };
        Update: {
          assigned_at?: string;
          member_id?: string;
          vessel_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vessel_assignments_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vessel_assignments_vessel_id_fkey";
            columns: ["vessel_id"];
            isOneToOne: false;
            referencedRelation: "vessel_summaries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vessel_assignments_vessel_id_fkey";
            columns: ["vessel_id"];
            isOneToOne: false;
            referencedRelation: "vessels";
            referencedColumns: ["id"];
          },
        ];
      };
      vessels: {
        Row: {
          created_at: string;
          id: string;
          imo_number: string;
          is_active: boolean;
          name: string;
          updated_at: string;
          vessel_type: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          imo_number: string;
          is_active?: boolean;
          name: string;
          updated_at?: string;
          vessel_type: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          imo_number?: string;
          is_active?: boolean;
          name?: string;
          updated_at?: string;
          vessel_type?: string;
        };
        Relationships: [];
      };
      work_order_events: {
        Row: {
          actor_id: string;
          comment: string | null;
          created_at: string;
          event_type: Database["public"]["Enums"]["work_order_event_type"];
          from_status: Database["public"]["Enums"]["work_order_status"] | null;
          id: number;
          to_status: Database["public"]["Enums"]["work_order_status"] | null;
          work_order_id: number;
        };
        ComputedFields: never;
        Insert: {
          actor_id: string;
          comment?: string | null;
          created_at?: string;
          event_type: Database["public"]["Enums"]["work_order_event_type"];
          from_status?: Database["public"]["Enums"]["work_order_status"] | null;
          id?: never;
          to_status?: Database["public"]["Enums"]["work_order_status"] | null;
          work_order_id: number;
        };
        Update: {
          actor_id?: string;
          comment?: string | null;
          created_at?: string;
          event_type?: Database["public"]["Enums"]["work_order_event_type"];
          from_status?: Database["public"]["Enums"]["work_order_status"] | null;
          id?: never;
          to_status?: Database["public"]["Enums"]["work_order_status"] | null;
          work_order_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "work_order_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_order_events_work_order_id_fkey";
            columns: ["work_order_id"];
            isOneToOne: false;
            referencedRelation: "work_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      work_orders: {
        Row: {
          assigned_to: string;
          attested_at: string | null;
          attested_by: string | null;
          created_at: string;
          created_by: string;
          id: number;
          issue: string;
          last_rejection_reason: string | null;
          rejection_count: number;
          solution: string | null;
          status: Database["public"]["Enums"]["work_order_status"];
          title: string;
          updated_at: string;
          vessel_id: string;
        };
        ComputedFields: never;
        Insert: {
          assigned_to: string;
          attested_at?: string | null;
          attested_by?: string | null;
          created_at?: string;
          created_by: string;
          id?: never;
          issue: string;
          last_rejection_reason?: string | null;
          rejection_count?: number;
          solution?: string | null;
          status?: Database["public"]["Enums"]["work_order_status"];
          title: string;
          updated_at?: string;
          vessel_id: string;
        };
        Update: {
          assigned_to?: string;
          attested_at?: string | null;
          attested_by?: string | null;
          created_at?: string;
          created_by?: string;
          id?: never;
          issue?: string;
          last_rejection_reason?: string | null;
          rejection_count?: number;
          solution?: string | null;
          status?: Database["public"]["Enums"]["work_order_status"];
          title?: string;
          updated_at?: string;
          vessel_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_orders_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_attested_by_fkey";
            columns: ["attested_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_vessel_id_fkey";
            columns: ["vessel_id"];
            isOneToOne: false;
            referencedRelation: "vessel_summaries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_orders_vessel_id_fkey";
            columns: ["vessel_id"];
            isOneToOne: false;
            referencedRelation: "vessels";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      vessel_summaries: {
        Row: {
          active_work_order_count: number | null;
          captain_count: number | null;
          created_at: string | null;
          crew_count: number | null;
          id: string | null;
          imo_number: string | null;
          is_active: boolean | null;
          name: string | null;
          updated_at: string | null;
          vessel_type: string | null;
        };
        ComputedFields: never;
        Insert: {
          active_work_order_count?: never;
          captain_count?: never;
          created_at?: string | null;
          crew_count?: never;
          id?: string | null;
          imo_number?: string | null;
          is_active?: boolean | null;
          name?: string | null;
          updated_at?: string | null;
          vessel_type?: string | null;
        };
        Update: {
          active_work_order_count?: never;
          captain_count?: never;
          created_at?: string | null;
          crew_count?: never;
          id?: string | null;
          imo_number?: string | null;
          is_active?: boolean | null;
          name?: string | null;
          updated_at?: string | null;
          vessel_type?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      act_as: { Args: { p_member_id: string }; Returns: Json };
      assign_member_to_vessel: {
        Args: { p_member_id: string; p_vessel_id: string };
        Returns: undefined;
      };
      attest_work_order: {
        Args: { p_comment?: string; p_work_order_id: number };
        Returns: undefined;
      };
      complete_work_order: {
        Args: { p_solution: string; p_work_order_id: number };
        Returns: undefined;
      };
      create_member: {
        Args: {
          p_email: string;
          p_full_name: string;
          p_role: Database["public"]["Enums"]["app_role"];
          p_vessel_ids?: string[];
        };
        Returns: string;
      };
      create_vessel: {
        Args: { p_imo_number: string; p_name: string; p_vessel_type: string };
        Returns: string;
      };
      create_work_order: {
        Args: {
          p_assigned_to: string;
          p_issue: string;
          p_title: string;
          p_vessel_id: string;
        };
        Returns: number;
      };
      list_directory: { Args: Record<PropertyKey, never>; Returns: Json };
      reassign_work_order: {
        Args: { p_assigned_to: string; p_work_order_id: number };
        Returns: undefined;
      };
      reject_work_order: {
        Args: { p_reason: string; p_work_order_id: number };
        Returns: undefined;
      };
      remove_member_from_vessel: {
        Args: { p_member_id: string; p_vessel_id: string };
        Returns: undefined;
      };
      reset_demo_data: { Args: Record<PropertyKey, never>; Returns: undefined };
      save_work_order_solution: {
        Args: { p_solution: string; p_work_order_id: number };
        Returns: undefined;
      };
      set_member_active: {
        Args: { p_is_active: boolean; p_member_id: string };
        Returns: undefined;
      };
      set_vessel_active: {
        Args: { p_is_active: boolean; p_vessel_id: string };
        Returns: undefined;
      };
      start_work_order: {
        Args: { p_work_order_id: number };
        Returns: undefined;
      };
      update_member: {
        Args: {
          p_email: string;
          p_full_name: string;
          p_member_id: string;
          p_role: Database["public"]["Enums"]["app_role"];
          p_vessel_ids?: string[];
        };
        Returns: undefined;
      };
      update_vessel: {
        Args: {
          p_imo_number: string;
          p_name: string;
          p_vessel_id: string;
          p_vessel_type: string;
        };
        Returns: undefined;
      };
      whoami: { Args: Record<PropertyKey, never>; Returns: Json };
      work_order_stats: { Args: { p_vessel_id?: string }; Returns: Json };
    };
    Enums: {
      app_role: "Admin" | "Captain" | "Crew";
      work_order_event_type:
        | "created"
        | "started"
        | "completed"
        | "attested"
        | "rejected"
        | "reassigned";
      work_order_status: "Open" | "In Progress" | "Done";
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["Admin", "Captain", "Crew"],
      work_order_event_type: [
        "created",
        "started",
        "completed",
        "attested",
        "rejected",
        "reassigned",
      ],
      work_order_status: ["Open", "In Progress", "Done"],
    },
  },
} as const;
