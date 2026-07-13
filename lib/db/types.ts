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
          legal_name: string | null;
          trade_name: string | null;
          slug: string | null;
          lifecycle_status: string;
          product_profile: string;
          locale: string;
          currency: string;
          timezone: string;
          plan_key: string | null;
          trial_started_at: string | null;
          trial_ends_at: string | null;
          onboarding_status: string;
          branding_complete: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          country?: string | null;
          storage_region?: string | null;
          legal_name?: string | null;
          trade_name?: string | null;
          slug?: string | null;
          lifecycle_status?: string;
          product_profile?: string;
          locale?: string;
          currency?: string;
          timezone?: string;
          plan_key?: string | null;
          trial_started_at?: string | null;
          trial_ends_at?: string | null;
          onboarding_status?: string;
          branding_complete?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          country?: string | null;
          storage_region?: string | null;
          legal_name?: string | null;
          trade_name?: string | null;
          slug?: string | null;
          lifecycle_status?: string;
          product_profile?: string;
          locale?: string;
          currency?: string;
          timezone?: string;
          plan_key?: string | null;
          trial_started_at?: string | null;
          trial_ends_at?: string | null;
          onboarding_status?: string;
          branding_complete?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tenant_branding: {
        Row: {
          tenant_id: string;
          display_name: string | null;
          logo_url: string | null;
          portal_logo_url: string | null;
          primary_color: string | null;
          secondary_color: string | null;
          email_footer: string | null;
          pdf_header_text: string | null;
          invoice_footer_text: string | null;
          support_email: string | null;
          support_phone: string | null;
          tagline: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          display_name?: string | null;
          logo_url?: string | null;
          portal_logo_url?: string | null;
          primary_color?: string | null;
          secondary_color?: string | null;
          email_footer?: string | null;
          pdf_header_text?: string | null;
          invoice_footer_text?: string | null;
          support_email?: string | null;
          support_phone?: string | null;
          tagline?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          display_name?: string | null;
          logo_url?: string | null;
          portal_logo_url?: string | null;
          primary_color?: string | null;
          secondary_color?: string | null;
          email_footer?: string | null;
          pdf_header_text?: string | null;
          invoice_footer_text?: string | null;
          support_email?: string | null;
          support_phone?: string | null;
          tagline?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_branding_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "organization";
            referencedColumns: ["id"];
          },
        ];
      };
      app_user: {
        Row: {
          id: string;
          tenant_id: string;
          email: string;
          name: string | null;
          status: string;
          is_system_admin: boolean;
          last_login_at: string | null;
          last_seen_at: string | null;
          last_login_method: string | null;
          login_count: number;
          onboarding_email_sent_at: string | null;
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
          last_login_at?: string | null;
          last_seen_at?: string | null;
          last_login_method?: string | null;
          login_count?: number;
          onboarding_email_sent_at?: string | null;
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
          last_login_at?: string | null;
          last_seen_at?: string | null;
          last_login_method?: string | null;
          login_count?: number;
          onboarding_email_sent_at?: string | null;
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
          client_user_id: string | null;
          platform_actor_id: string | null;
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
          client_user_id?: string | null;
          platform_actor_id?: string | null;
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
          client_user_id?: string | null;
          platform_actor_id?: string | null;
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
          {
            foreignKeyName: "audit_log_platform_actor_id_fkey";
            columns: ["platform_actor_id"];
            referencedRelation: "platform_admin";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admin: {
        Row: {
          id: string;
          email: string;
          name: string | null;
          platform_role: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          name?: string | null;
          platform_role: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          name?: string | null;
          platform_role?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_admin_id_fkey";
            columns: ["id"];
            referencedRelation: "users";
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
      client: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          ninea: string | null;
          segment: string | null;
          email: string | null;
          phone: string | null;
          address: string | null;
          account_manager_id: string | null;
          status: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          ninea?: string | null;
          segment?: string | null;
          email?: string | null;
          phone?: string | null;
          address?: string | null;
          account_manager_id?: string | null;
          status?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          ninea?: string | null;
          segment?: string | null;
          email?: string | null;
          phone?: string | null;
          address?: string | null;
          account_manager_id?: string | null;
          status?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "client_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "organization";
            referencedColumns: ["id"];
          },
        ];
      };
      client_contact: {
        Row: {
          id: string;
          tenant_id: string;
          client_id: string;
          name: string;
          role: string | null;
          email: string | null;
          phone: string | null;
          is_primary: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          client_id: string;
          name: string;
          role?: string | null;
          email?: string | null;
          phone?: string | null;
          is_primary?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          client_id?: string;
          name?: string;
          role?: string | null;
          email?: string | null;
          phone?: string | null;
          is_primary?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_contact_client_id_fkey";
            columns: ["client_id"];
            referencedRelation: "client";
            referencedColumns: ["id"];
          },
        ];
      };
      operational_file: {
        Row: {
          id: string;
          tenant_id: string;
          file_number: string;
          type: string;
          client_id: string;
          account_manager_id: string | null;
          coordinator_id: string | null;
          assigned_to_user_id: string | null;
          status: string;
          priority: string;
          opened_at: string | null;
          archived_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_number: string;
          type: string;
          client_id: string;
          account_manager_id?: string | null;
          coordinator_id?: string | null;
          assigned_to_user_id?: string | null;
          status?: string;
          priority?: string;
          opened_at?: string | null;
          archived_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          file_number?: string;
          type?: string;
          client_id?: string;
          account_manager_id?: string | null;
          coordinator_id?: string | null;
          assigned_to_user_id?: string | null;
          status?: string;
          priority?: string;
          opened_at?: string | null;
          archived_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "operational_file_client_id_fkey";
            columns: ["client_id"];
            referencedRelation: "client";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_file_assigned_to_user_id_fkey";
            columns: ["assigned_to_user_id"];
            referencedRelation: "app_user";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_file_tenant_id_fkey";
            columns: ["tenant_id"];
            referencedRelation: "organization";
            referencedColumns: ["id"];
          },
        ];
      };
      shipment: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string;
          transport_mode: string | null;
          incoterm: string | null;
          origin: string | null;
          destination: string | null;
          cargo_type: string | null;
          carrier_name: string | null;
          vessel_or_flight: string | null;
          bl_awb_ref: string | null;
          container_ref: string | null;
          etd: string | null;
          atd: string | null;
          eta: string | null;
          ata: string | null;
          pickup_planned: string | null;
          pickup_actual: string | null;
          delivery_planned: string | null;
          delivery_actual: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_id: string;
          transport_mode?: string | null;
          incoterm?: string | null;
          origin?: string | null;
          destination?: string | null;
          cargo_type?: string | null;
          carrier_name?: string | null;
          vessel_or_flight?: string | null;
          bl_awb_ref?: string | null;
          container_ref?: string | null;
          etd?: string | null;
          atd?: string | null;
          eta?: string | null;
          ata?: string | null;
          pickup_planned?: string | null;
          pickup_actual?: string | null;
          delivery_planned?: string | null;
          delivery_actual?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          file_id?: string;
          transport_mode?: string | null;
          incoterm?: string | null;
          origin?: string | null;
          destination?: string | null;
          cargo_type?: string | null;
          carrier_name?: string | null;
          vessel_or_flight?: string | null;
          bl_awb_ref?: string | null;
          container_ref?: string | null;
          etd?: string | null;
          atd?: string | null;
          eta?: string | null;
          ata?: string | null;
          pickup_planned?: string | null;
          pickup_actual?: string | null;
          delivery_planned?: string | null;
          delivery_actual?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shipment_file_id_fkey";
            columns: ["file_id"];
            referencedRelation: "operational_file";
            referencedColumns: ["id"];
          },
        ];
      };
      file_state_transition: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string;
          from_status: string | null;
          to_status: string;
          actor_id: string | null;
          note: string | null;
          occurred_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_id: string;
          from_status?: string | null;
          to_status: string;
          actor_id?: string | null;
          note?: string | null;
          occurred_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          file_id?: string;
          from_status?: string | null;
          to_status?: string;
          actor_id?: string | null;
          note?: string | null;
          occurred_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "file_state_transition_file_id_fkey";
            columns: ["file_id"];
            referencedRelation: "operational_file";
            referencedColumns: ["id"];
          },
        ];
      };
      file_counter: {
        Row: { tenant_id: string; type: string; year: number; next_seq: number };
        Insert: { tenant_id: string; type: string; year: number; next_seq?: number };
        Update: { tenant_id?: string; type?: string; year?: number; next_seq?: number };
        Relationships: [];
      };
      task: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string;
          title: string;
          description: string | null;
          status: string;
          priority: string;
          due_at: string | null;
          assigned_to: string | null;
          created_by: string | null;
          completed_at: string | null;
          handoff_type: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_id: string;
          title: string;
          description?: string | null;
          status?: string;
          priority?: string;
          due_at?: string | null;
          assigned_to?: string | null;
          created_by?: string | null;
          completed_at?: string | null;
          handoff_type?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          file_id?: string;
          title?: string;
          description?: string | null;
          status?: string;
          priority?: string;
          due_at?: string | null;
          assigned_to?: string | null;
          created_by?: string | null;
          completed_at?: string | null;
          handoff_type?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_file_id_fkey";
            columns: ["file_id"];
            referencedRelation: "operational_file";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_assigned_to_fkey";
            columns: ["assigned_to"];
            referencedRelation: "app_user";
            referencedColumns: ["id"];
          },
        ];
      };
      notification: {
        Row: {
          id: string;
          tenant_id: string;
          user_id: string;
          type: string;
          task_id: string | null;
          file_id: string | null;
          title: string;
          body: string | null;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          user_id: string;
          type: string;
          task_id?: string | null;
          file_id?: string | null;
          title: string;
          body?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          user_id?: string;
          type?: string;
          task_id?: string | null;
          file_id?: string | null;
          title?: string;
          body?: string | null;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "app_user";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_task_id_fkey";
            columns: ["task_id"];
            referencedRelation: "task";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notification_file_id_fkey";
            columns: ["file_id"];
            referencedRelation: "operational_file";
            referencedColumns: ["id"];
          },
        ];
      };
      document_type: {
        Row: {
          code: string;
          label_fr: string;
          label_en: string | null;
          category: string;
          has_validity: boolean;
          default_validity_days: number | null;
          renewable: boolean;
          required_for: string[];
          conditional: boolean;
          active: boolean;
          sort_order: number;
          gates_customs: boolean;
        };
        Insert: {
          code: string;
          label_fr: string;
          label_en?: string | null;
          category: string;
          has_validity?: boolean;
          default_validity_days?: number | null;
          renewable?: boolean;
          required_for?: string[];
          conditional?: boolean;
          active?: boolean;
          sort_order?: number;
          gates_customs?: boolean;
        };
        Update: {
          code?: string;
          label_fr?: string;
          label_en?: string | null;
          category?: string;
          has_validity?: boolean;
          default_validity_days?: number | null;
          renewable?: boolean;
          required_for?: string[];
          conditional?: boolean;
          active?: boolean;
          sort_order?: number;
          gates_customs?: boolean;
        };
        Relationships: [];
      };
      customs_record: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string;
          status: string;
          required: boolean;
          declaration_number: string | null;
          customs_office: string | null;
          regime: string | null;
          declaration_date: string | null;
          bae_reference: string | null;
          release_date: string | null;
          inspection_status: string;
          external_ref: string | null;
          notes: string | null;
          created_by: string | null;
          reviewed_by: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_id: string;
          status?: string;
          required?: boolean;
          declaration_number?: string | null;
          customs_office?: string | null;
          regime?: string | null;
          declaration_date?: string | null;
          bae_reference?: string | null;
          release_date?: string | null;
          inspection_status?: string;
          external_ref?: string | null;
          notes?: string | null;
          created_by?: string | null;
          reviewed_by?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          file_id?: string;
          status?: string;
          required?: boolean;
          declaration_number?: string | null;
          customs_office?: string | null;
          regime?: string | null;
          declaration_date?: string | null;
          bae_reference?: string | null;
          release_date?: string | null;
          inspection_status?: string;
          external_ref?: string | null;
          notes?: string | null;
          created_by?: string | null;
          reviewed_by?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customs_record_file_id_fkey";
            columns: ["file_id"];
            referencedRelation: "operational_file";
            referencedColumns: ["id"];
          },
        ];
      };
      document: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string;
          type_code: string;
          title: string | null;
          status: string;
          version: number;
          supersedes_id: string | null;
          expiry_date: string | null;
          storage_path: string;
          mime_type: string | null;
          size_bytes: number | null;
          uploaded_by: string | null;
          reviewed_by: string | null;
          review_note: string | null;
          shared_with_client: boolean;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_id: string;
          type_code: string;
          title?: string | null;
          status?: string;
          version?: number;
          supersedes_id?: string | null;
          expiry_date?: string | null;
          storage_path: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          uploaded_by?: string | null;
          reviewed_by?: string | null;
          review_note?: string | null;
          shared_with_client?: boolean;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          file_id?: string;
          type_code?: string;
          title?: string | null;
          status?: string;
          version?: number;
          supersedes_id?: string | null;
          expiry_date?: string | null;
          storage_path?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          uploaded_by?: string | null;
          reviewed_by?: string | null;
          review_note?: string | null;
          shared_with_client?: boolean;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_file_id_fkey";
            columns: ["file_id"];
            referencedRelation: "operational_file";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_type_code_fkey";
            columns: ["type_code"];
            referencedRelation: "document_type";
            referencedColumns: ["code"];
          },
        ];
      };
      transport_record: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string;
          status: string;
          pickup_location: string | null;
          delivery_location: string | null;
          pickup_planned: string | null;
          pickup_actual: string | null;
          delivery_planned: string | null;
          delivery_actual: string | null;
          driver_name: string | null;
          driver_phone: string | null;
          vehicle_plate: string | null;
          trailer_or_container: string | null;
          transport_company: string | null;
          delivery_reference: string | null;
          pod_document_id: string | null;
          customs_override: boolean;
          notes: string | null;
          created_by: string | null;
          assigned_by: string | null;
          driver_user_id: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_id: string;
          status?: string;
          pickup_location?: string | null;
          delivery_location?: string | null;
          pickup_planned?: string | null;
          pickup_actual?: string | null;
          delivery_planned?: string | null;
          delivery_actual?: string | null;
          driver_name?: string | null;
          driver_phone?: string | null;
          vehicle_plate?: string | null;
          trailer_or_container?: string | null;
          transport_company?: string | null;
          delivery_reference?: string | null;
          pod_document_id?: string | null;
          customs_override?: boolean;
          notes?: string | null;
          created_by?: string | null;
          assigned_by?: string | null;
          driver_user_id?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          file_id?: string;
          status?: string;
          pickup_location?: string | null;
          delivery_location?: string | null;
          pickup_planned?: string | null;
          pickup_actual?: string | null;
          delivery_planned?: string | null;
          delivery_actual?: string | null;
          driver_name?: string | null;
          driver_phone?: string | null;
          vehicle_plate?: string | null;
          trailer_or_container?: string | null;
          transport_company?: string | null;
          delivery_reference?: string | null;
          pod_document_id?: string | null;
          customs_override?: boolean;
          notes?: string | null;
          created_by?: string | null;
          assigned_by?: string | null;
          driver_user_id?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "transport_record_file_id_fkey";
            columns: ["file_id"];
            referencedRelation: "operational_file";
            referencedColumns: ["id"];
          },
        ];
      };
      tracking_session: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string;
          transport_id: string | null;
          driver_id: string | null;
          vehicle_plate: string | null;
          source: string;
          status: string;
          started_at: string;
          ended_at: string | null;
          last_position_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_id: string;
          transport_id?: string | null;
          driver_id?: string | null;
          vehicle_plate?: string | null;
          source?: string;
          status?: string;
          started_at?: string;
          ended_at?: string | null;
          last_position_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          file_id?: string;
          transport_id?: string | null;
          driver_id?: string | null;
          vehicle_plate?: string | null;
          source?: string;
          status?: string;
          started_at?: string;
          ended_at?: string | null;
          last_position_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tracking_session_file_id_fkey";
            columns: ["file_id"];
            referencedRelation: "operational_file";
            referencedColumns: ["id"];
          },
        ];
      };
      tracking_position: {
        Row: {
          id: string;
          tenant_id: string;
          tracking_session_id: string | null;
          file_id: string;
          transport_id: string | null;
          latitude: number;
          longitude: number;
          accuracy_meters: number | null;
          heading_degrees: number | null;
          speed_kph: number | null;
          source: string;
          customer_visible: boolean;
          recorded_at: string;
          received_at: string;
          recorded_by: string | null;
          idempotency_key: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          tracking_session_id?: string | null;
          file_id: string;
          transport_id?: string | null;
          latitude: number;
          longitude: number;
          accuracy_meters?: number | null;
          heading_degrees?: number | null;
          speed_kph?: number | null;
          source: string;
          customer_visible?: boolean;
          recorded_at: string;
          received_at?: string;
          recorded_by?: string | null;
          idempotency_key?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          tracking_session_id?: string | null;
          file_id?: string;
          transport_id?: string | null;
          latitude?: number;
          longitude?: number;
          accuracy_meters?: number | null;
          heading_degrees?: number | null;
          speed_kph?: number | null;
          source?: string;
          customer_visible?: boolean;
          recorded_at?: string;
          received_at?: string;
          recorded_by?: string | null;
          idempotency_key?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tracking_position_file_id_fkey";
            columns: ["file_id"];
            referencedRelation: "operational_file";
            referencedColumns: ["id"];
          },
        ];
      };
      tracking_event: {
        Row: {
          id: string;
          tenant_id: string;
          tracking_session_id: string | null;
          file_id: string;
          transport_id: string | null;
          type: string;
          source: string;
          customer_visible: boolean;
          customer_message: string | null;
          internal_note: string | null;
          latitude: number | null;
          longitude: number | null;
          dedup_key: string | null;
          detail: Json | null;
          occurred_at: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          tracking_session_id?: string | null;
          file_id: string;
          transport_id?: string | null;
          type: string;
          source?: string;
          customer_visible?: boolean;
          customer_message?: string | null;
          internal_note?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          dedup_key?: string | null;
          detail?: Json | null;
          occurred_at?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          tracking_session_id?: string | null;
          file_id?: string;
          transport_id?: string | null;
          type?: string;
          source?: string;
          customer_visible?: boolean;
          customer_message?: string | null;
          internal_note?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          dedup_key?: string | null;
          detail?: Json | null;
          occurred_at?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tracking_event_file_id_fkey";
            columns: ["file_id"];
            referencedRelation: "operational_file";
            referencedColumns: ["id"];
          },
        ];
      };
      // ---------------------------------------------------------------------
      // Phase 5.0B — official process engine (20260713000001_process_engine.sql).
      // Hand-written to match the migration: `supabase gen types` needs a live DB
      // and the agent environment has none. Keep in sync with the migration.
      // ---------------------------------------------------------------------
      process_instance: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string;
          process_version: string;
          status: string;
          compatibility_source: string;
          compatibility_version: string | null;
          started_at: string;
          completed_at: string | null;
          closed_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_id: string;
          process_version?: string;
          status?: string;
          compatibility_source?: string;
          compatibility_version?: string | null;
          started_at?: string;
          completed_at?: string | null;
          closed_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: string;
          compatibility_source?: string;
          compatibility_version?: string | null;
          completed_at?: string | null;
          closed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "process_instance_file_id_fkey";
            columns: ["file_id"];
            referencedRelation: "operational_file";
            referencedColumns: ["id"];
          },
        ];
      };
      process_step_execution: {
        Row: {
          id: string;
          tenant_id: string;
          process_instance_id: string;
          step_key: string;
          step_number: number | null;
          state: string;
          assigned_user_id: string | null;
          assigned_role_code: string | null;
          submitted_by: string | null;
          submitted_at: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          received_from_user_id: string | null;
          received_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          rejected_at: string | null;
          rejected_by: string | null;
          rejection_reason: string | null;
          correction_of_id: string | null;
          override_used: boolean;
          override_reason: string | null;
          evidence_summary: Json | null;
          metadata: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          process_instance_id: string;
          step_key: string;
          step_number?: number | null;
          state?: string;
          assigned_user_id?: string | null;
          assigned_role_code?: string | null;
          submitted_by?: string | null;
          submitted_at?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          received_from_user_id?: string | null;
          received_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          rejected_at?: string | null;
          rejected_by?: string | null;
          rejection_reason?: string | null;
          correction_of_id?: string | null;
          override_used?: boolean;
          override_reason?: string | null;
          evidence_summary?: Json | null;
          metadata?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          state?: string;
          assigned_user_id?: string | null;
          assigned_role_code?: string | null;
          submitted_by?: string | null;
          submitted_at?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          received_from_user_id?: string | null;
          received_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          rejected_at?: string | null;
          rejected_by?: string | null;
          rejection_reason?: string | null;
          override_used?: boolean;
          override_reason?: string | null;
          evidence_summary?: Json | null;
          metadata?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "process_step_execution_process_instance_id_fkey";
            columns: ["process_instance_id"];
            referencedRelation: "process_instance";
            referencedColumns: ["id"];
          },
        ];
      };
      process_handoff: {
        Row: {
          id: string;
          tenant_id: string;
          process_instance_id: string;
          from_step_key: string;
          to_step_key: string;
          sent_by: string;
          sent_at: string;
          received_by: string | null;
          received_at: string | null;
          status: string;
          rejection_reason: string | null;
          returned_to_step_key: string | null;
          dedup_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          process_instance_id: string;
          from_step_key: string;
          to_step_key: string;
          sent_by: string;
          sent_at?: string;
          received_by?: string | null;
          received_at?: string | null;
          status?: string;
          rejection_reason?: string | null;
          returned_to_step_key?: string | null;
          dedup_key: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: string;
          received_by?: string | null;
          received_at?: string | null;
          rejection_reason?: string | null;
          returned_to_step_key?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "process_handoff_process_instance_id_fkey";
            columns: ["process_instance_id"];
            referencedRelation: "process_instance";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_charge: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string;
          description: string;
          quantity: number;
          unit_amount: number;
          tax_rate: number;
          currency: string;
          created_by: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_id: string;
          description: string;
          quantity?: number;
          unit_amount?: number;
          tax_rate?: number;
          currency?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          file_id?: string;
          description?: string;
          quantity?: number;
          unit_amount?: number;
          tax_rate?: number;
          currency?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "billing_charge_file_id_fkey";
            columns: ["file_id"];
            referencedRelation: "operational_file";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string;
          client_id: string | null;
          invoice_number: string | null;
          status: string;
          currency: string;
          issue_date: string | null;
          due_date: string | null;
          notes: string | null;
          created_by: string | null;
          issued_by: string | null;
          voided_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_id: string;
          client_id?: string | null;
          invoice_number?: string | null;
          status?: string;
          currency?: string;
          issue_date?: string | null;
          due_date?: string | null;
          notes?: string | null;
          created_by?: string | null;
          issued_by?: string | null;
          voided_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          file_id?: string;
          client_id?: string | null;
          invoice_number?: string | null;
          status?: string;
          currency?: string;
          issue_date?: string | null;
          due_date?: string | null;
          notes?: string | null;
          created_by?: string | null;
          issued_by?: string | null;
          voided_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_file_id_fkey";
            columns: ["file_id"];
            referencedRelation: "operational_file";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_line: {
        Row: {
          id: string;
          tenant_id: string;
          invoice_id: string;
          charge_id: string | null;
          description: string;
          quantity: number;
          unit_amount: number;
          tax_rate: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          invoice_id: string;
          charge_id?: string | null;
          description: string;
          quantity?: number;
          unit_amount?: number;
          tax_rate?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          invoice_id?: string;
          charge_id?: string | null;
          description?: string;
          quantity?: number;
          unit_amount?: number;
          tax_rate?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_line_invoice_id_fkey";
            columns: ["invoice_id"];
            referencedRelation: "invoice";
            referencedColumns: ["id"];
          },
        ];
      };
      payment: {
        Row: {
          id: string;
          tenant_id: string;
          invoice_id: string;
          amount: number;
          method: string;
          reference: string | null;
          paid_at: string;
          reversed_at: string | null;
          reversed_by: string | null;
          recorded_by: string | null;
          created_at: string;
          provider_name: string | null;
          provider_reference: string | null;
          received_by: string | null;
          verification_status: string;
          verified_by: string | null;
          verified_at: string | null;
          verification_note: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          invoice_id: string;
          amount: number;
          method: string;
          reference?: string | null;
          paid_at?: string;
          reversed_at?: string | null;
          reversed_by?: string | null;
          recorded_by?: string | null;
          created_at?: string;
          provider_name?: string | null;
          provider_reference?: string | null;
          received_by?: string | null;
          verification_status?: string;
          verified_by?: string | null;
          verified_at?: string | null;
          verification_note?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          invoice_id?: string;
          amount?: number;
          method?: string;
          reference?: string | null;
          paid_at?: string;
          reversed_at?: string | null;
          reversed_by?: string | null;
          recorded_by?: string | null;
          created_at?: string;
          provider_name?: string | null;
          provider_reference?: string | null;
          received_by?: string | null;
          verification_status?: string;
          verified_by?: string | null;
          verified_at?: string | null;
          verification_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_invoice_id_fkey";
            columns: ["invoice_id"];
            referencedRelation: "invoice";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_intent: {
        Row: {
          id: string;
          tenant_id: string;
          invoice_id: string;
          provider: string;
          amount: number;
          currency: string;
          status: string;
          provider_intent_id: string | null;
          provider_checkout_url: string | null;
          provider_reference: string | null;
          payment_id: string | null;
          expires_at: string | null;
          completed_at: string | null;
          failed_at: string | null;
          last_error: string | null;
          created_by: string | null;
          created_by_client: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          invoice_id: string;
          provider: string;
          amount: number;
          currency?: string;
          status?: string;
          provider_intent_id?: string | null;
          provider_checkout_url?: string | null;
          provider_reference?: string | null;
          payment_id?: string | null;
          expires_at?: string | null;
          completed_at?: string | null;
          failed_at?: string | null;
          last_error?: string | null;
          created_by?: string | null;
          created_by_client?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          invoice_id?: string;
          provider?: string;
          amount?: number;
          currency?: string;
          status?: string;
          provider_intent_id?: string | null;
          provider_checkout_url?: string | null;
          provider_reference?: string | null;
          payment_id?: string | null;
          expires_at?: string | null;
          completed_at?: string | null;
          failed_at?: string | null;
          last_error?: string | null;
          created_by?: string | null;
          created_by_client?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_intent_invoice_id_fkey";
            columns: ["invoice_id"];
            referencedRelation: "invoice";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_webhook_event: {
        Row: {
          id: string;
          tenant_id: string | null;
          provider: string;
          provider_event_id: string;
          event_type: string;
          payment_intent_id: string | null;
          signature_valid: boolean;
          outcome: string;
          received_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string | null;
          provider: string;
          provider_event_id: string;
          event_type: string;
          payment_intent_id?: string | null;
          signature_valid: boolean;
          outcome: string;
          received_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string | null;
          provider?: string;
          provider_event_id?: string;
          event_type?: string;
          payment_intent_id?: string | null;
          signature_valid?: boolean;
          outcome?: string;
          received_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_webhook_event_payment_intent_id_fkey";
            columns: ["payment_intent_id"];
            referencedRelation: "payment_intent";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_counter: {
        Row: { tenant_id: string; year: number; next_seq: number };
        Insert: { tenant_id: string; year: number; next_seq?: number };
        Update: { tenant_id?: string; year?: number; next_seq?: number };
        Relationships: [];
      };
      communication_message: {
        Row: {
          id: string;
          tenant_id: string;
          recipient_email: string;
          recipient_name: string | null;
          channel: string;
          template_key: string;
          subject: string;
          body_html: string;
          body_text: string;
          payload: Json | null;
          status: string;
          related_entity: string | null;
          related_entity_id: string | null;
          file_id: string | null;
          client_id: string | null;
          retry_count: number;
          last_error: string | null;
          sent_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          recipient_email: string;
          recipient_name?: string | null;
          channel?: string;
          template_key: string;
          subject: string;
          body_html: string;
          body_text: string;
          payload?: Json | null;
          status?: string;
          related_entity?: string | null;
          related_entity_id?: string | null;
          file_id?: string | null;
          client_id?: string | null;
          retry_count?: number;
          last_error?: string | null;
          sent_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          recipient_email?: string;
          recipient_name?: string | null;
          channel?: string;
          template_key?: string;
          subject?: string;
          body_html?: string;
          body_text?: string;
          payload?: Json | null;
          status?: string;
          related_entity?: string | null;
          related_entity_id?: string | null;
          file_id?: string | null;
          client_id?: string | null;
          retry_count?: number;
          last_error?: string | null;
          sent_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      client_user: {
        Row: {
          id: string;
          tenant_id: string;
          client_id: string;
          email: string;
          name: string | null;
          status: string;
          role: string;
          invited_by: string | null;
          invited_at: string;
          last_login_at: string | null;
          last_seen_at: string | null;
          last_login_method: string | null;
          login_count: number;
          onboarding_email_sent_at: string | null;
          must_change_password: boolean;
          notify_email: boolean;
          notify_shipment: boolean;
          notify_invoice: boolean;
          notify_payment: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          tenant_id: string;
          client_id: string;
          email: string;
          name?: string | null;
          status?: string;
          role?: string;
          invited_by?: string | null;
          invited_at?: string;
          last_login_at?: string | null;
          last_seen_at?: string | null;
          last_login_method?: string | null;
          login_count?: number;
          onboarding_email_sent_at?: string | null;
          must_change_password?: boolean;
          notify_email?: boolean;
          notify_shipment?: boolean;
          notify_invoice?: boolean;
          notify_payment?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          client_id?: string;
          email?: string;
          name?: string | null;
          status?: string;
          role?: string;
          invited_by?: string | null;
          invited_at?: string;
          last_login_at?: string | null;
          last_seen_at?: string | null;
          last_login_method?: string | null;
          login_count?: number;
          onboarding_email_sent_at?: string | null;
          must_change_password?: boolean;
          notify_email?: boolean;
          notify_shipment?: boolean;
          notify_invoice?: boolean;
          notify_payment?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_user_client_id_fkey";
            columns: ["client_id"];
            referencedRelation: "client";
            referencedColumns: ["id"];
          },
        ];
      };
      client_notification: {
        Row: {
          id: string;
          tenant_id: string;
          client_id: string;
          event_type: string;
          category: string;
          template_key: string | null;
          title: string;
          body: string;
          file_id: string | null;
          invoice_id: string | null;
          dedup_key: string;
          read_at: string | null;
          archived_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          client_id: string;
          event_type: string;
          category: string;
          template_key?: string | null;
          title: string;
          body: string;
          file_id?: string | null;
          invoice_id?: string | null;
          dedup_key: string;
          read_at?: string | null;
          archived_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          client_id?: string;
          event_type?: string;
          category?: string;
          template_key?: string | null;
          title?: string;
          body?: string;
          file_id?: string | null;
          invoice_id?: string | null;
          dedup_key?: string;
          read_at?: string | null;
          archived_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_user_permissions: {
        Args: { p_user: string };
        Returns: { code: string }[];
      };
      next_file_number: {
        Args: { p_tenant: string; p_type: string };
        Returns: string;
      };
      next_invoice_number: {
        Args: { p_tenant: string };
        Returns: string;
      };
      auth_tenant_id: { Args: Record<string, never>; Returns: string };
      has_permission: { Args: { p_code: string }; Returns: boolean };
      has_role: { Args: { p_code: string }; Returns: boolean };
      auth_is_platform_admin: { Args: Record<string, never>; Returns: boolean };
      user_readable_file_ids: {
        Args: { p_user: string; p_tenant: string };
        Returns: { id: string }[];
      };
      can_read_file: { Args: { p_file: string }; Returns: boolean };
      can_read_task: { Args: { p_task: string }; Returns: boolean };
      auth_portal_client_id: { Args: Record<string, never>; Returns: string };
      auth_portal_tenant_id: { Args: Record<string, never>; Returns: string };
      portal_can_read_file: { Args: { p_file: string }; Returns: boolean };
      portal_can_read_invoice: { Args: { p_invoice: string }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
