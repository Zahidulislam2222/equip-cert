export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string
          details: Json
          id: string
          ip_address: unknown
          organization_id: string
          resource_id: string | null
          resource_type: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json
          id?: string
          ip_address?: unknown
          organization_id: string
          resource_id?: string | null
          resource_type: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json
          id?: string
          ip_address?: unknown
          organization_id?: string
          resource_id?: string | null
          resource_type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_records: {
        Row: {
          document_version: string
          granted: boolean
          id: string
          ip_address: unknown
          method: Database["public"]["Enums"]["consent_method"]
          organization_id: string
          purpose: Database["public"]["Enums"]["consent_purpose"]
          recorded_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          document_version: string
          granted: boolean
          id?: string
          ip_address?: unknown
          method?: Database["public"]["Enums"]["consent_method"]
          organization_id: string
          purpose: Database["public"]["Enums"]["consent_purpose"]
          recorded_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          document_version?: string
          granted?: boolean
          id?: string
          ip_address?: unknown
          method?: Database["public"]["Enums"]["consent_method"]
          organization_id?: string
          purpose?: Database["public"]["Enums"]["consent_purpose"]
          recorded_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      corrective_actions: {
        Row: {
          assigned_to: string | null
          checklist_item_id: string | null
          created_at: string
          defect_photo_url: string | null
          description: string
          due_date: string | null
          id: string
          inspection_id: number
          organization_id: string
          resolution_notes: string | null
          resolution_photo_url: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["corrective_severity"]
          status: Database["public"]["Enums"]["corrective_status"]
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          checklist_item_id?: string | null
          created_at?: string
          defect_photo_url?: string | null
          description: string
          due_date?: string | null
          id?: string
          inspection_id: number
          organization_id: string
          resolution_notes?: string | null
          resolution_photo_url?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["corrective_severity"]
          status?: Database["public"]["Enums"]["corrective_status"]
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          checklist_item_id?: string | null
          created_at?: string
          defect_photo_url?: string | null
          description?: string
          due_date?: string | null
          id?: string
          inspection_id?: number
          organization_id?: string
          resolution_notes?: string | null
          resolution_photo_url?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["corrective_severity"]
          status?: Database["public"]["Enums"]["corrective_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "corrective_actions_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrective_actions_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrective_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrective_actions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      data_subject_requests: {
        Row: {
          completed_at: string | null
          due_at: string
          id: string
          notes: string | null
          organization_id: string | null
          received_at: string
          refusal_reason: string | null
          regime: Database["public"]["Enums"]["dsr_regime"]
          request_type: Database["public"]["Enums"]["dsr_type"]
          status: Database["public"]["Enums"]["dsr_status"]
          subject_email: string
          subject_user_id: string | null
          verification_method: string | null
          verified_at: string | null
        }
        Insert: {
          completed_at?: string | null
          due_at: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          received_at?: string
          refusal_reason?: string | null
          regime?: Database["public"]["Enums"]["dsr_regime"]
          request_type: Database["public"]["Enums"]["dsr_type"]
          status?: Database["public"]["Enums"]["dsr_status"]
          subject_email: string
          subject_user_id?: string | null
          verification_method?: string | null
          verified_at?: string | null
        }
        Update: {
          completed_at?: string | null
          due_at?: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          received_at?: string
          refusal_reason?: string | null
          regime?: Database["public"]["Enums"]["dsr_regime"]
          request_type?: Database["public"]["Enums"]["dsr_type"]
          status?: Database["public"]["Enums"]["dsr_status"]
          subject_email?: string
          subject_user_id?: string | null
          verification_method?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_subject_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment: {
        Row: {
          created_at: string
          id: string
          last_inspection_date: string | null
          location: string | null
          metadata: Json
          name: string
          next_due_date: string | null
          organization_id: string
          photo_url: string | null
          serial_number: string | null
          status: Database["public"]["Enums"]["equipment_status"]
          type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_inspection_date?: string | null
          location?: string | null
          metadata?: Json
          name: string
          next_due_date?: string | null
          organization_id: string
          photo_url?: string | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["equipment_status"]
          type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_inspection_date?: string | null
          location?: string | null
          metadata?: Json
          name?: string
          next_due_date?: string | null
          organization_id?: string
          photo_url?: string | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["equipment_status"]
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          ai_assisted: boolean
          ai_disclosed_at: string | null
          ai_model: string | null
          ai_provider: string | null
          audit_trail: Json
          checklist_data: Json
          created_at: string
          device_info: Json
          equipment_id: string | null
          equipment_name: string
          id: number
          inspector_id: string | null
          inspector_name: string
          location_address: string | null
          location_lat: number | null
          location_lng: number | null
          organization_id: string
          photo_url: string | null
          signature_url: string | null
          status: Database["public"]["Enums"]["inspection_status"]
        }
        Insert: {
          ai_assisted?: boolean
          ai_disclosed_at?: string | null
          ai_model?: string | null
          ai_provider?: string | null
          audit_trail?: Json
          checklist_data?: Json
          created_at?: string
          device_info?: Json
          equipment_id?: string | null
          equipment_name: string
          id?: never
          inspector_id?: string | null
          inspector_name: string
          location_address?: string | null
          location_lat?: number | null
          location_lng?: number | null
          organization_id: string
          photo_url?: string | null
          signature_url?: string | null
          status: Database["public"]["Enums"]["inspection_status"]
        }
        Update: {
          ai_assisted?: boolean
          ai_disclosed_at?: string | null
          ai_model?: string | null
          ai_provider?: string | null
          audit_trail?: Json
          checklist_data?: Json
          created_at?: string
          device_info?: Json
          equipment_id?: string | null
          equipment_name?: string
          id?: never
          inspector_id?: string | null
          inspector_name?: string
          location_address?: string | null
          location_lat?: number | null
          location_lng?: number | null
          organization_id?: string
          photo_url?: string | null
          signature_url?: string | null
          status?: Database["public"]["Enums"]["inspection_status"]
        }
        Relationships: [
          {
            foreignKeyName: "inspections_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          org_id: string
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          action_url?: string | null
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          org_id: string
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          action_url?: string | null
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          org_id?: string
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name: string
          plan: string
          retention_months: number
          slug: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          plan?: string
          retention_months?: number
          slug: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          plan?: string
          retention_months?: number
          slug?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_plan_fkey"
            columns: ["plan"]
            isOneToOne: false
            referencedRelation: "plan_limits"
            referencedColumns: ["plan_id"]
          },
        ]
      }
      plan_limits: {
        Row: {
          allows_signatures: boolean
          generated_from: string
          max_ai_analyses_month: number | null
          max_inspections_month: number | null
          max_users: number | null
          plan_id: string
        }
        Insert: {
          allows_signatures?: boolean
          generated_from?: string
          max_ai_analyses_month?: number | null
          max_inspections_month?: number | null
          max_users?: number | null
          plan_id: string
        }
        Update: {
          allows_signatures?: boolean
          generated_from?: string
          max_ai_analyses_month?: number | null
          max_inspections_month?: number | null
          max_users?: number | null
          plan_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          anonymized_at: string | null
          avatar_url: string | null
          created_at: string
          esign_consent: boolean
          esign_consent_at: string | null
          full_name: string
          id: string
          org_id: string
          qualifications: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          anonymized_at?: string | null
          avatar_url?: string | null
          created_at?: string
          esign_consent?: boolean
          esign_consent_at?: string | null
          full_name: string
          id?: string
          org_id: string
          qualifications?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          anonymized_at?: string | null
          avatar_url?: string | null
          created_at?: string
          esign_consent?: boolean
          esign_consent_at?: string | null
          full_name?: string
          id?: string
          org_id?: string
          qualifications?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          assigned_to: string | null
          created_at: string
          equipment_id: string
          frequency: Database["public"]["Enums"]["schedule_frequency"]
          id: string
          is_active: boolean
          last_completed: string | null
          next_due: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          equipment_id: string
          frequency: Database["public"]["Enums"]["schedule_frequency"]
          id?: string
          is_active?: boolean
          last_completed?: string | null
          next_due: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          equipment_id?: string
          frequency?: Database["public"]["Enums"]["schedule_frequency"]
          id?: string
          is_active?: boolean
          last_completed?: string | null
          next_due?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      consent_method: "web_form" | "mobile_app" | "api" | "import"
      consent_purpose:
        | "terms"
        | "privacy_policy"
        | "esign_disclosure"
        | "ai_processing"
        | "marketing_email"
      corrective_severity: "critical" | "major" | "minor"
      corrective_status: "open" | "in_progress" | "resolved" | "overdue"
      dsr_regime: "gdpr" | "us_state"
      dsr_status:
        | "received"
        | "identity_pending"
        | "in_progress"
        | "completed"
        | "refused"
        | "extended"
      dsr_type:
        | "access"
        | "rectification"
        | "erasure"
        | "portability"
        | "restriction"
        | "objection"
        | "opt_out_sale"
      equipment_status: "active" | "out_of_service" | "retired"
      inspection_status: "Safe" | "Action Required"
      notification_type:
        | "inspection_due"
        | "corrective_assigned"
        | "corrective_overdue"
        | "inspection_failed"
        | "system"
      schedule_frequency:
        | "daily"
        | "weekly"
        | "monthly"
        | "quarterly"
        | "annually"
      user_role: "admin" | "manager" | "technician"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      consent_method: ["web_form", "mobile_app", "api", "import"],
      consent_purpose: [
        "terms",
        "privacy_policy",
        "esign_disclosure",
        "ai_processing",
        "marketing_email",
      ],
      corrective_severity: ["critical", "major", "minor"],
      corrective_status: ["open", "in_progress", "resolved", "overdue"],
      dsr_regime: ["gdpr", "us_state"],
      dsr_status: [
        "received",
        "identity_pending",
        "in_progress",
        "completed",
        "refused",
        "extended",
      ],
      dsr_type: [
        "access",
        "rectification",
        "erasure",
        "portability",
        "restriction",
        "objection",
        "opt_out_sale",
      ],
      equipment_status: ["active", "out_of_service", "retired"],
      inspection_status: ["Safe", "Action Required"],
      notification_type: [
        "inspection_due",
        "corrective_assigned",
        "corrective_overdue",
        "inspection_failed",
        "system",
      ],
      schedule_frequency: [
        "daily",
        "weekly",
        "monthly",
        "quarterly",
        "annually",
      ],
      user_role: ["admin", "manager", "technician"],
    },
  },
} as const
