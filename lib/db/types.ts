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
          client_user_id: string | null;
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
      invoice_counter: {
        Row: { tenant_id: string; year: number; next_seq: number };
        Insert: { tenant_id: string; year: number; next_seq?: number };
        Update: { tenant_id?: string; year?: number; next_seq?: number };
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
      user_readable_file_ids: {
        Args: { p_user: string; p_tenant: string };
        Returns: { id: string }[];
      };
      can_read_file: { Args: { p_file: string }; Returns: boolean };
      can_read_task: { Args: { p_task: string }; Returns: boolean };
      auth_portal_client_id: { Args: Record<string, never>; Returns: string };
      auth_portal_tenant_id: { Args: Record<string, never>; Returns: string };
      portal_can_read_file: { Args: { p_file: string }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
