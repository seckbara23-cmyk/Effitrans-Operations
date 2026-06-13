/**
 * Database types — FOUNDATION schema.
 * ---------------------------------------------------------------------------
 * ⚠️ HAND-AUTHORED STOPGAP. This mirrors the three foundation migrations so the
 * Supabase clients are typed today, before the project is linked. Once linked,
 * REGENERATE it from the live schema and commit the result:
 *
 *     npm run db:types            # local stack
 *     # or: supabase gen types typescript --linked > lib/db/types.ts
 *
 * The generated file is authoritative and supersedes this one. Keep the column
 * names/types in sync with supabase/migrations/* until then. No business tables.
 */

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
      organization: {
        Row: {
          id: string;
          name: string;
          country: string | null;
          storage_region: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          country?: string | null;
          storage_region?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          country?: string | null;
          storage_region?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      app_user: {
        Row: {
          id: string;
          tenant_id: string;
          email: string;
          name: string | null;
          status: string;
          is_system_admin: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          email: string;
          name?: string | null;
          status?: string;
          is_system_admin?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          email?: string;
          name?: string | null;
          status?: string;
          is_system_admin?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "app_user_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "organization";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: string;
          tenant_id: string | null;
          actor_id: string | null;
          action: string;
          entity: string | null;
          entity_id: string | null;
          before: Json | null;
          after: Json | null;
          override_reason: string | null;
          occurred_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string | null;
          actor_id?: string | null;
          action: string;
          entity?: string | null;
          entity_id?: string | null;
          before?: Json | null;
          after?: Json | null;
          override_reason?: string | null;
          occurred_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string | null;
          actor_id?: string | null;
          action?: string;
          entity?: string | null;
          entity_id?: string | null;
          before?: Json | null;
          after?: Json | null;
          override_reason?: string | null;
          occurred_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey";
            columns: ["actor_id"];
            referencedRelation: "app_user";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_log_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "organization";
            referencedColumns: ["id"];
          },
        ];
      };
      permission: {
        Row: {
          id: string;
          code: string;
          module: string;
          action: string;
          data_scope: string;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          module: string;
          action: string;
          data_scope: string;
          description?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          code?: string;
          module?: string;
          action?: string;
          data_scope?: string;
          description?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      role: {
        Row: {
          id: string;
          tenant_id: string;
          code: string;
          label_fr: string | null;
          label_en: string | null;
          is_provisional: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          code: string;
          label_fr?: string | null;
          label_en?: string | null;
          is_provisional?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          code?: string;
          label_fr?: string | null;
          label_en?: string | null;
          is_provisional?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "role_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "organization";
            referencedColumns: ["id"];
          },
        ];
      };
      role_permission: {
        Row: { role_id: string; permission_id: string };
        Insert: { role_id: string; permission_id: string };
        Update: { role_id?: string; permission_id?: string };
        Relationships: [
          {
            foreignKeyName: "role_permission_role_id_fkey";
            columns: ["role_id"];
            referencedRelation: "role";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "role_permission_permission_id_fkey";
            columns: ["permission_id"];
            referencedRelation: "permission";
            referencedColumns: ["id"];
          },
        ];
      };
      user_role: {
        Row: {
          user_id: string;
          role_id: string;
          tenant_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          role_id: string;
          tenant_id: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          role_id?: string;
          tenant_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_role_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "app_user";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_role_role_id_fkey";
            columns: ["role_id"];
            referencedRelation: "role";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_role_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "organization";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_user_permissions: {
        Args: { p_user: string };
        Returns: { code: string }[];
      };
      auth_tenant_id: { Args: Record<string, never>; Returns: string };
      has_permission: { Args: { p_code: string }; Returns: boolean };
      has_role: { Args: { p_code: string }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
