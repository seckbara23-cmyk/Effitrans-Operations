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
          // 2026-07-29 (migration 20260729000001) — staff password lifecycle.
          password_changed_at: string | null;
          must_change_password: boolean;
          temp_password_expires_at: string | null;
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
          password_changed_at?: string | null;
          must_change_password?: boolean;
          temp_password_expires_at?: string | null;
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
          password_changed_at?: string | null;
          must_change_password?: boolean;
          temp_password_expires_at?: string | null;
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
          requires_physical_invoice_deposit: boolean;
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
          requires_physical_invoice_deposit?: boolean;
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
          requires_physical_invoice_deposit?: boolean;
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
          // Phase 7.2A — shipment-level ocean state (additive).
          ocean_milestone: string;
          provider_code: string;
          carrier_id: string | null;
          booking_reference: string | null;
          booking_status: string | null;
          master_bl: string | null;
          house_bl: string | null;
          eta_source: string | null;
          eta_confidence: string | null;
          eta_calculated_at: string | null;
          eta_previous: string | null;
          tracking_synced_at: string | null;
          tracking_version: number;
          air_milestone: string;
          air_provider_code: string;
          airline_id: string | null;
          air_tracking_version: number;
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
          ocean_milestone?: string;
          provider_code?: string;
          carrier_id?: string | null;
          booking_reference?: string | null;
          booking_status?: string | null;
          master_bl?: string | null;
          house_bl?: string | null;
          eta_source?: string | null;
          eta_confidence?: string | null;
          eta_calculated_at?: string | null;
          eta_previous?: string | null;
          tracking_synced_at?: string | null;
          tracking_version?: number;
          air_milestone?: string;
          air_provider_code?: string;
          airline_id?: string | null;
          air_tracking_version?: number;
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
          ocean_milestone?: string;
          provider_code?: string;
          carrier_id?: string | null;
          booking_reference?: string | null;
          booking_status?: string | null;
          master_bl?: string | null;
          house_bl?: string | null;
          eta_source?: string | null;
          eta_confidence?: string | null;
          eta_calculated_at?: string | null;
          eta_previous?: string | null;
          tracking_synced_at?: string | null;
          tracking_version?: number;
          air_milestone?: string;
          air_provider_code?: string;
          airline_id?: string | null;
          air_tracking_version?: number;
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
      // Phase 7.2A — Shipping Line Platform (ocean satellite tables).
      ocean_carrier: {
        Row: { id: string; tenant_id: string; code: string; name: string; scac: string | null; website: string | null; active: boolean; notes: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; code: string; name: string; scac?: string | null; website?: string | null; active?: boolean; notes?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; code?: string; name?: string; scac?: string | null; website?: string | null; active?: boolean; notes?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      ocean_port: {
        Row: { id: string; tenant_id: string; unlocode: string | null; name: string; country: string | null; latitude: number | null; longitude: number | null; timezone: string | null; active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; unlocode?: string | null; name: string; country?: string | null; latitude?: number | null; longitude?: number | null; timezone?: string | null; active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; unlocode?: string | null; name?: string; country?: string | null; latitude?: number | null; longitude?: number | null; timezone?: string | null; active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      ocean_vessel: {
        Row: { id: string; tenant_id: string; name: string; imo: string | null; mmsi: string | null; flag: string | null; carrier_id: string | null; active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; name: string; imo?: string | null; mmsi?: string | null; flag?: string | null; carrier_id?: string | null; active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; name?: string; imo?: string | null; mmsi?: string | null; flag?: string | null; carrier_id?: string | null; active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      ocean_voyage: {
        Row: { id: string; tenant_id: string; carrier_voyage_ref: string | null; vessel_id: string | null; origin_port_id: string | null; destination_port_id: string | null; planned_departure: string | null; actual_departure: string | null; planned_arrival: string | null; actual_arrival: string | null; status: string; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; carrier_voyage_ref?: string | null; vessel_id?: string | null; origin_port_id?: string | null; destination_port_id?: string | null; planned_departure?: string | null; actual_departure?: string | null; planned_arrival?: string | null; actual_arrival?: string | null; status?: string; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; carrier_voyage_ref?: string | null; vessel_id?: string | null; origin_port_id?: string | null; destination_port_id?: string | null; planned_departure?: string | null; actual_departure?: string | null; planned_arrival?: string | null; actual_arrival?: string | null; status?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      ocean_container: {
        Row: { id: string; tenant_id: string; shipment_id: string; container_number: string; iso_type: string | null; seal_number: string | null; gross_weight_kg: number | null; status: string; vessel_id: string | null; voyage_id: string | null; last_event_at: string | null; position_confidence: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; shipment_id: string; container_number: string; iso_type?: string | null; seal_number?: string | null; gross_weight_kg?: number | null; status?: string; vessel_id?: string | null; voyage_id?: string | null; last_event_at?: string | null; position_confidence?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; shipment_id?: string; container_number?: string; iso_type?: string | null; seal_number?: string | null; gross_weight_kg?: number | null; status?: string; vessel_id?: string | null; voyage_id?: string | null; last_event_at?: string | null; position_confidence?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      ocean_route_leg: {
        Row: { id: string; tenant_id: string; shipment_id: string; sequence: number; origin_port_id: string | null; destination_port_id: string | null; mode: string; vessel_id: string | null; voyage_id: string | null; planned_departure: string | null; actual_departure: string | null; planned_arrival: string | null; actual_arrival: string | null; status: string; source: string; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; shipment_id: string; sequence: number; origin_port_id?: string | null; destination_port_id?: string | null; mode?: string; vessel_id?: string | null; voyage_id?: string | null; planned_departure?: string | null; actual_departure?: string | null; planned_arrival?: string | null; actual_arrival?: string | null; status?: string; source?: string; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; shipment_id?: string; sequence?: number; origin_port_id?: string | null; destination_port_id?: string | null; mode?: string; vessel_id?: string | null; voyage_id?: string | null; planned_departure?: string | null; actual_departure?: string | null; planned_arrival?: string | null; actual_arrival?: string | null; status?: string; source?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      ocean_port_call: {
        Row: { id: string; tenant_id: string; shipment_id: string; voyage_id: string | null; port_id: string | null; arrival: string | null; berth: string | null; departure: string | null; terminal: string | null; source: string; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; shipment_id: string; voyage_id?: string | null; port_id?: string | null; arrival?: string | null; berth?: string | null; departure?: string | null; terminal?: string | null; source?: string; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; shipment_id?: string; voyage_id?: string | null; port_id?: string | null; arrival?: string | null; berth?: string | null; departure?: string | null; terminal?: string | null; source?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      ocean_tracking_event: {
        Row: { id: string; tenant_id: string; shipment_id: string; container_id: string | null; event_type: string; occurred_at: string; received_at: string; source: string; provider_code: string; confidence: string; location_name: string | null; location_unlocode: string | null; latitude: number | null; longitude: number | null; vessel_imo: string | null; vessel_mmsi: string | null; vessel_name: string | null; voyage_reference: string | null; description: string | null; fingerprint: string; provider_event_id: string | null; created_by: string | null; created_at: string };
        Insert: { id?: string; tenant_id: string; shipment_id: string; container_id?: string | null; event_type: string; occurred_at: string; received_at?: string; source: string; provider_code?: string; confidence: string; location_name?: string | null; location_unlocode?: string | null; latitude?: number | null; longitude?: number | null; vessel_imo?: string | null; vessel_mmsi?: string | null; vessel_name?: string | null; voyage_reference?: string | null; description?: string | null; fingerprint: string; provider_event_id?: string | null; created_by?: string | null; created_at?: string };
        Update: { id?: string; tenant_id?: string; shipment_id?: string; container_id?: string | null; event_type?: string; occurred_at?: string; received_at?: string; source?: string; provider_code?: string; confidence?: string; location_name?: string | null; location_unlocode?: string | null; latitude?: number | null; longitude?: number | null; vessel_imo?: string | null; vessel_mmsi?: string | null; vessel_name?: string | null; voyage_reference?: string | null; description?: string | null; fingerprint?: string; provider_event_id?: string | null; created_by?: string | null; created_at?: string };
        Relationships: [];
      };
      // Phase 7.3A — Air Cargo Platform (sibling ocean tables).
      air_airline: {
        Row: { id: string; tenant_id: string; name: string; iata: string | null; icao: string | null; website: string | null; active: boolean; notes: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; name: string; iata?: string | null; icao?: string | null; website?: string | null; active?: boolean; notes?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; name?: string; iata?: string | null; icao?: string | null; website?: string | null; active?: boolean; notes?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      air_airport: {
        Row: { id: string; tenant_id: string; iata: string | null; icao: string | null; name: string; city: string | null; country: string | null; latitude: number | null; longitude: number | null; timezone: string | null; active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; iata?: string | null; icao?: string | null; name: string; city?: string | null; country?: string | null; latitude?: number | null; longitude?: number | null; timezone?: string | null; active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; iata?: string | null; icao?: string | null; name?: string; city?: string | null; country?: string | null; latitude?: number | null; longitude?: number | null; timezone?: string | null; active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      air_flight: {
        Row: { id: string; tenant_id: string; flight_number: string | null; airline_id: string | null; origin_airport_id: string | null; destination_airport_id: string | null; scheduled_departure: string | null; scheduled_arrival: string | null; actual_departure: string | null; actual_arrival: string | null; status: string; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; flight_number?: string | null; airline_id?: string | null; origin_airport_id?: string | null; destination_airport_id?: string | null; scheduled_departure?: string | null; scheduled_arrival?: string | null; actual_departure?: string | null; actual_arrival?: string | null; status?: string; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; flight_number?: string | null; airline_id?: string | null; origin_airport_id?: string | null; destination_airport_id?: string | null; scheduled_departure?: string | null; scheduled_arrival?: string | null; actual_departure?: string | null; actual_arrival?: string | null; status?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      air_flight_leg: {
        Row: { id: string; tenant_id: string; flight_id: string; sequence: number; origin_airport_id: string | null; destination_airport_id: string | null; connection_airport_id: string | null; std: string | null; sta: string | null; atd: string | null; ata: string | null; status: string; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; flight_id: string; sequence: number; origin_airport_id?: string | null; destination_airport_id?: string | null; connection_airport_id?: string | null; std?: string | null; sta?: string | null; atd?: string | null; ata?: string | null; status?: string; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; flight_id?: string; sequence?: number; origin_airport_id?: string | null; destination_airport_id?: string | null; connection_airport_id?: string | null; std?: string | null; sta?: string | null; atd?: string | null; ata?: string | null; status?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      air_awb: {
        Row: { id: string; tenant_id: string; shipment_id: string; flight_id: string | null; mawb: string | null; hawb: string | null; status: string; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; shipment_id: string; flight_id?: string | null; mawb?: string | null; hawb?: string | null; status?: string; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; shipment_id?: string; flight_id?: string | null; mawb?: string | null; hawb?: string | null; status?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      air_uld: {
        Row: { id: string; tenant_id: string; shipment_id: string; flight_id: string | null; uld_number: string; uld_type: string | null; owner: string | null; status: string; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; shipment_id: string; flight_id?: string | null; uld_number: string; uld_type?: string | null; owner?: string | null; status?: string; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; shipment_id?: string; flight_id?: string | null; uld_number?: string; uld_type?: string | null; owner?: string | null; status?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      air_cargo_piece: {
        Row: { id: string; tenant_id: string; shipment_id: string; uld_id: string | null; piece_count: number; weight_kg: number | null; volume_m3: number | null; dimensions: string | null; special_handling: string | null; dangerous_goods: boolean; temperature_controlled: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; shipment_id: string; uld_id?: string | null; piece_count?: number; weight_kg?: number | null; volume_m3?: number | null; dimensions?: string | null; special_handling?: string | null; dangerous_goods?: boolean; temperature_controlled?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; shipment_id?: string; uld_id?: string | null; piece_count?: number; weight_kg?: number | null; volume_m3?: number | null; dimensions?: string | null; special_handling?: string | null; dangerous_goods?: boolean; temperature_controlled?: boolean; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      air_tracking_event: {
        Row: { id: string; tenant_id: string; shipment_id: string; uld_id: string | null; event_type: string; occurred_at: string; received_at: string; source: string; provider_code: string; confidence: string; location_name: string | null; location_iata: string | null; latitude: number | null; longitude: number | null; flight_number: string | null; description: string | null; fingerprint: string; provider_event_id: string | null; created_by: string | null; created_at: string };
        Insert: { id?: string; tenant_id: string; shipment_id: string; uld_id?: string | null; event_type: string; occurred_at: string; received_at?: string; source: string; provider_code?: string; confidence: string; location_name?: string | null; location_iata?: string | null; latitude?: number | null; longitude?: number | null; flight_number?: string | null; description?: string | null; fingerprint: string; provider_event_id?: string | null; created_by?: string | null; created_at?: string };
        Update: { id?: string; tenant_id?: string; shipment_id?: string; uld_id?: string | null; event_type?: string; occurred_at?: string; received_at?: string; source?: string; provider_code?: string; confidence?: string; location_name?: string | null; location_iata?: string | null; latitude?: number | null; longitude?: number | null; flight_number?: string | null; description?: string | null; fingerprint?: string; provider_event_id?: string | null; created_by?: string | null; created_at?: string };
        Relationships: [];
      };
      // Phase 7.4A — Document Intelligence.
      document_intelligence_job: {
        Row: { id: string; tenant_id: string; document_id: string; file_id: string; document_version: number; storage_path: string | null; checksum: string | null; mime_type: string | null; byte_size: number | null; page_count: number | null; declared_class: string | null; predicted_class: string | null; classification_confidence: string | null; status: string; provider_code: string; extraction_method: string | null; extracted_text: string | null; failure_category: string | null; job_version: number; created_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; document_id: string; file_id: string; document_version?: number; storage_path?: string | null; checksum?: string | null; mime_type?: string | null; byte_size?: number | null; page_count?: number | null; declared_class?: string | null; predicted_class?: string | null; classification_confidence?: string | null; status?: string; provider_code?: string; extraction_method?: string | null; extracted_text?: string | null; failure_category?: string | null; job_version?: number; created_by?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; document_id?: string; file_id?: string; document_version?: number; storage_path?: string | null; checksum?: string | null; mime_type?: string | null; byte_size?: number | null; page_count?: number | null; declared_class?: string | null; predicted_class?: string | null; classification_confidence?: string | null; status?: string; provider_code?: string; extraction_method?: string | null; extracted_text?: string | null; failure_category?: string | null; job_version?: number; created_by?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      document_candidate_field: {
        Row: { id: string; tenant_id: string; job_id: string; file_id: string; document_class: string; field_key: string; displayed_value: string | null; normalized_value: string | null; confidence: string; page: number | null; evidence: string | null; validation_status: string; reconciliation_status: string | null; review_decision: string; edited_value: string | null; reviewed_by: string | null; reviewed_at: string | null; application_target: string | null; application_result: string | null; applied_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; job_id: string; file_id: string; document_class: string; field_key: string; displayed_value?: string | null; normalized_value?: string | null; confidence?: string; page?: number | null; evidence?: string | null; validation_status?: string; reconciliation_status?: string | null; review_decision?: string; edited_value?: string | null; reviewed_by?: string | null; reviewed_at?: string | null; application_target?: string | null; application_result?: string | null; applied_at?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; tenant_id?: string; job_id?: string; file_id?: string; document_class?: string; field_key?: string; displayed_value?: string | null; normalized_value?: string | null; confidence?: string; page?: number | null; evidence?: string | null; validation_status?: string; reconciliation_status?: string | null; review_decision?: string; edited_value?: string | null; reviewed_by?: string | null; reviewed_at?: string | null; application_target?: string | null; application_result?: string | null; applied_at?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
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
          conversation_id: string | null;
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
          conversation_id?: string | null;
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
          conversation_id?: string | null;
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
          // Phase 7.1B — canonical Customs Intelligence lifecycle (additive).
          intel_status: string;
          provider_code: string;
          provider_reference: string | null;
          provider_synced_at: string | null;
          provider_error: string | null;
          intel_version: number;
          submitted_at: string | null;
          released_at: string | null;
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
          intel_status?: string;
          provider_code?: string;
          provider_reference?: string | null;
          provider_synced_at?: string | null;
          provider_error?: string | null;
          intel_version?: number;
          submitted_at?: string | null;
          released_at?: string | null;
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
          intel_status?: string;
          provider_code?: string;
          provider_reference?: string | null;
          provider_synced_at?: string | null;
          provider_error?: string | null;
          intel_version?: number;
          submitted_at?: string | null;
          released_at?: string | null;
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
          // Phase WES-4 / WES-4G. Nullable: legacy rows were never hashed and
          // no value is fabricated for them.
          content_sha256: string | null;
          source_sha256: string | null;
          renderer_version: string | null;
          generated_by: string | null;
          generated_at: string | null;
          policy_version_id: string | null;
          superseded_by_id: string | null;
          provenance: string;
          artifact_code: string | null;
          source_snapshot: Json | null;
          artifact_provenance: string | null;
          /** UAT-2B — set ONLY on OFFICIAL_INVOICE artifacts. */
          invoice_id: string | null;
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
          // Phase WES-4 / WES-4G.
          content_sha256?: string | null;
          source_sha256?: string | null;
          renderer_version?: string | null;
          generated_by?: string | null;
          generated_at?: string | null;
          policy_version_id?: string | null;
          superseded_by_id?: string | null;
          provenance?: string;
          artifact_code?: string | null;
          source_snapshot?: Json | null;
          artifact_provenance?: string | null;
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
          owner_user_id: string | null;
          owner_assigned_at: string | null;
          owner_assigned_by: string | null;
          owner_assignment_reason: string | null;
          policy_version_id: string | null;
          policy_provenance: string;
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
          owner_user_id?: string | null;
          owner_assigned_at?: string | null;
          owner_assigned_by?: string | null;
          owner_assignment_reason?: string | null;
          policy_version_id?: string | null;
          policy_provenance?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: string;
          policy_version_id?: string | null;
          policy_provenance?: string;
          compatibility_source?: string;
          compatibility_version?: string | null;
          completed_at?: string | null;
          closed_at?: string | null;
          owner_user_id?: string | null;
          owner_assigned_at?: string | null;
          owner_assigned_by?: string | null;
          owner_assignment_reason?: string | null;
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
          assigned_team_code: string | null;
          skipped_by: string | null;
          skipped_at: string | null;
          skip_reason: string | null;
          skip_source: string | null;
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
          assigned_team_code?: string | null;
          skipped_by?: string | null;
          skipped_at?: string | null;
          skip_reason?: string | null;
          skip_source?: string | null;
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
          assigned_team_code?: string | null;
          skipped_by?: string | null;
          skipped_at?: string | null;
          skip_reason?: string | null;
          skip_source?: string | null;
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
      // ---------------------------------------------------------------------
      // Phase 5.0D — post-delivery chain (20260714000001).
      // Hand-written to match the migration (no live DB to generate against).
      // ---------------------------------------------------------------------
      /** Phase 5.0E-2A — per-tenant rollout of the official process engine. */
      tenant_process_rollout: {
        Row: {
          tenant_id: string;
          process_engine: boolean;
          process_workspaces: boolean;
          physical_invoice_deposit: boolean;
          collections: boolean;
          note: string | null;
          first_enabled_at: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          tenant_id: string;
          process_engine?: boolean;
          process_workspaces?: boolean;
          physical_invoice_deposit?: boolean;
          collections?: boolean;
          note?: string | null;
          first_enabled_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          tenant_id?: string;
          process_engine?: boolean;
          process_workspaces?: boolean;
          physical_invoice_deposit?: boolean;
          collections?: boolean;
          note?: string | null;
          first_enabled_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      brand_asset: {
        Row: {
          id: string; tenant_id: string; kind: string; title: string | null; storage_path: string;
          version: number; mime: string; bytes: number; width: number | null; height: number | null;
          alt_text: string; checksum: string | null; status: string; source_note: string | null;
          uploaded_by: string | null; created_at: string; retired_at: string | null;
        };
        Insert: {
          id?: string; tenant_id: string; kind: string; title?: string | null; storage_path: string;
          version?: number; mime: string; bytes: number; width?: number | null; height?: number | null;
          alt_text: string; checksum?: string | null; status?: string; source_note?: string | null;
          uploaded_by?: string | null; created_at?: string; retired_at?: string | null;
        };
        Update: {
          id?: string; tenant_id?: string; kind?: string; title?: string | null; storage_path?: string;
          version?: number; mime?: string; bytes?: number; width?: number | null; height?: number | null;
          alt_text?: string; checksum?: string | null; status?: string; source_note?: string | null;
          uploaded_by?: string | null; created_at?: string; retired_at?: string | null;
        };
        Relationships: [];
      };
      tenant_brand_profile: {
        Row: {
          tenant_id: string; color_green: string | null; color_gold: string | null; color_anthracite: string | null;
          font_heading: string | null; font_body: string | null; font_email_fallback: string | null;
          slogan: string | null; value_proposition: string | null; address: string | null; legal_identifiers: string | null;
          website_url: string | null; linkedin_url: string | null; whistleblower_url: string | null;
          compliance_title: string | null; compliance_subtitle: string | null; compliance_description: string | null;
          compliance_button_label: string | null; sustainability_statement: string | null;
          environmental_print_statement: string | null; footer_line: string | null;
          created_at: string; updated_at: string; updated_by: string | null;
        };
        Insert: {
          tenant_id: string; color_green?: string | null; color_gold?: string | null; color_anthracite?: string | null;
          font_heading?: string | null; font_body?: string | null; font_email_fallback?: string | null;
          slogan?: string | null; value_proposition?: string | null; address?: string | null; legal_identifiers?: string | null;
          website_url?: string | null; linkedin_url?: string | null; whistleblower_url?: string | null;
          compliance_title?: string | null; compliance_subtitle?: string | null; compliance_description?: string | null;
          compliance_button_label?: string | null; sustainability_statement?: string | null;
          environmental_print_statement?: string | null; footer_line?: string | null;
          created_at?: string; updated_at?: string; updated_by?: string | null;
        };
        Update: {
          tenant_id?: string; color_green?: string | null; color_gold?: string | null; color_anthracite?: string | null;
          font_heading?: string | null; font_body?: string | null; font_email_fallback?: string | null;
          slogan?: string | null; value_proposition?: string | null; address?: string | null; legal_identifiers?: string | null;
          website_url?: string | null; linkedin_url?: string | null; whistleblower_url?: string | null;
          compliance_title?: string | null; compliance_subtitle?: string | null; compliance_description?: string | null;
          compliance_button_label?: string | null; sustainability_statement?: string | null;
          environmental_print_statement?: string | null; footer_line?: string | null;
          created_at?: string; updated_at?: string; updated_by?: string | null;
        };
        Relationships: [];
      };
      tenant_membership_registry: {
        Row: {
          id: string; tenant_id: string; organization_name: string; membership_id: string | null;
          official_url: string | null; status: string; valid_from: string | null; expires_at: string | null;
          display_order: number; logo_asset_id: string | null; asset_use_notes: string | null;
          created_at: string; updated_at: string; updated_by: string | null;
        };
        Insert: {
          id?: string; tenant_id: string; organization_name: string; membership_id?: string | null;
          official_url?: string | null; status?: string; valid_from?: string | null; expires_at?: string | null;
          display_order?: number; logo_asset_id?: string | null; asset_use_notes?: string | null;
          created_at?: string; updated_at?: string; updated_by?: string | null;
        };
        Update: {
          id?: string; tenant_id?: string; organization_name?: string; membership_id?: string | null;
          official_url?: string | null; status?: string; valid_from?: string | null; expires_at?: string | null;
          display_order?: number; logo_asset_id?: string | null; asset_use_notes?: string | null;
          created_at?: string; updated_at?: string; updated_by?: string | null;
        };
        Relationships: [];
      };
      workforce_profile: {
        Row: {
          user_id: string; tenant_id: string; job_title: string | null; phone_office: string | null;
          phone_mobile: string | null; whatsapp: string | null; photo_asset_id: string | null;
          signature_variant: string; public_card_enabled: boolean; public_card_token: string | null;
          token_rotated_at: string | null; created_at: string; updated_at: string; updated_by: string | null;
        };
        Insert: {
          user_id: string; tenant_id: string; job_title?: string | null; phone_office?: string | null;
          phone_mobile?: string | null; whatsapp?: string | null; photo_asset_id?: string | null;
          signature_variant?: string; public_card_enabled?: boolean; public_card_token?: string | null;
          token_rotated_at?: string | null; created_at?: string; updated_at?: string; updated_by?: string | null;
        };
        Update: {
          user_id?: string; tenant_id?: string; job_title?: string | null; phone_office?: string | null;
          phone_mobile?: string | null; whatsapp?: string | null; photo_asset_id?: string | null;
          signature_variant?: string; public_card_enabled?: boolean; public_card_token?: string | null;
          token_rotated_at?: string | null; created_at?: string; updated_at?: string; updated_by?: string | null;
        };
        Relationships: [];
      };
      brand_template: {
        Row: {
          id: string; tenant_id: string; category: string; template_key: string;
          lifecycle_status: string; version: number; updated_by: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; tenant_id: string; category: string; template_key: string;
          lifecycle_status?: string; version?: number; updated_by?: string | null; created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; tenant_id?: string; category?: string; template_key?: string;
          lifecycle_status?: string; version?: number; updated_by?: string | null; created_at?: string; updated_at?: string;
        };
        Relationships: [];
      };
      invoice_deposit_event: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string;
          invoice_id: string;
          deposit_id: string;
          event: string;
          from_status: string | null;
          to_status: string;
          actor_id: string | null;
          actor_role_code: string | null;
          from_department: string | null;
          to_department: string | null;
          handoff_id: string | null;
          evidence_document_id: string | null;
          reason: string | null;
          occurred_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_id: string;
          invoice_id: string;
          deposit_id: string;
          event: string;
          from_status?: string | null;
          to_status: string;
          actor_id?: string | null;
          actor_role_code?: string | null;
          from_department?: string | null;
          to_department?: string | null;
          handoff_id?: string | null;
          evidence_document_id?: string | null;
          reason?: string | null;
          occurred_at?: string;
        };
        Update: Record<string, never>; // append-only (trigger-enforced)
        Relationships: [
          {
            foreignKeyName: "invoice_deposit_event_deposit_id_fkey";
            columns: ["deposit_id"];
            referencedRelation: "invoice_deposit";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_deposit: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string;
          invoice_id: string;
          status: string;
          prepared_by: string | null;
          prepared_at: string | null;
          courier_user_id: string | null;
          assigned_at: string | null;
          departed_at: string | null;
          deposited_at: string | null;
          recipient_name: string | null;
          recipient_role: string | null;
          client_location: string | null;
          delivery_instructions: string | null;
          proof_document_id: string | null;
          returned_to_admin_at: string | null;
          validated_by_admin: string | null;
          validated_at: string | null;
          rejection_reason: string | null;
          failure_reason: string | null;
          accepted_at: string | null;
          declined_at: string | null;
          decline_reason: string | null;
          reassignment_reason: string | null;
          package_reference: string | null;
          recipient_org: string | null;
          proof_submitted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_id: string;
          invoice_id: string;
          status?: string;
          prepared_by?: string | null;
          prepared_at?: string | null;
          courier_user_id?: string | null;
          assigned_at?: string | null;
          departed_at?: string | null;
          deposited_at?: string | null;
          recipient_name?: string | null;
          recipient_role?: string | null;
          client_location?: string | null;
          delivery_instructions?: string | null;
          proof_document_id?: string | null;
          returned_to_admin_at?: string | null;
          validated_by_admin?: string | null;
          validated_at?: string | null;
          rejection_reason?: string | null;
          failure_reason?: string | null;
          accepted_at?: string | null;
          declined_at?: string | null;
          decline_reason?: string | null;
          reassignment_reason?: string | null;
          package_reference?: string | null;
          recipient_org?: string | null;
          proof_submitted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: string;
          prepared_by?: string | null;
          prepared_at?: string | null;
          courier_user_id?: string | null;
          assigned_at?: string | null;
          departed_at?: string | null;
          deposited_at?: string | null;
          recipient_name?: string | null;
          recipient_role?: string | null;
          client_location?: string | null;
          delivery_instructions?: string | null;
          proof_document_id?: string | null;
          returned_to_admin_at?: string | null;
          validated_by_admin?: string | null;
          validated_at?: string | null;
          rejection_reason?: string | null;
          failure_reason?: string | null;
          accepted_at?: string | null;
          declined_at?: string | null;
          decline_reason?: string | null;
          reassignment_reason?: string | null;
          package_reference?: string | null;
          recipient_org?: string | null;
          proof_submitted_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_deposit_invoice_id_fkey";
            columns: ["invoice_id"];
            referencedRelation: "invoice";
            referencedColumns: ["id"];
          },
        ];
      };
      collection_follow_up: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string;
          invoice_id: string;
          performed_by: string | null;
          channel: string;
          outcome: string;
          note: string | null;
          promised_payment_date: string | null;
          next_follow_up_at: string | null;
          promised_amount: number | null;
          dispute_category: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_id: string;
          invoice_id: string;
          performed_by?: string | null;
          channel: string;
          outcome: string;
          note?: string | null;
          promised_payment_date?: string | null;
          next_follow_up_at?: string | null;
          promised_amount?: number | null;
          dispute_category?: string | null;
          created_at?: string;
        };
        Update: Record<string, never>; // append-only (trigger-enforced)
        Relationships: [
          {
            foreignKeyName: "collection_follow_up_invoice_id_fkey";
            columns: ["invoice_id"];
            referencedRelation: "invoice";
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
          file_id: string | null;
          // FIN-AGING-2 (migration 20260729000002) — Q-08 provenance.
          provenance: string;
          legacy_file_reference: string | null;
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
          // Phase 5.0D — maker-checker (official steps 20-21) + dispute flag.
          submitted_by: string | null;
          submitted_at: string | null;
          validated_by: string | null;
          validated_at: string | null;
          rejected_by: string | null;
          rejected_at: string | null;
          rejection_reason: string | null;
          revision: number;
          disputed_at: string | null;
          dispute_reason: string | null;
          collections_assignee_id: string | null;
          collections_received_at: string | null;
          dispute_category: string | null;
          dispute_opened_by: string | null;
          dispute_resolved_at: string | null;
          dispute_resolution: string | null;
          escalated_at: string | null;
          collections_completed_at: string | null;
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
          submitted_by?: string | null;
          submitted_at?: string | null;
          validated_by?: string | null;
          validated_at?: string | null;
          rejected_by?: string | null;
          rejected_at?: string | null;
          rejection_reason?: string | null;
          revision?: number;
          disputed_at?: string | null;
          dispute_reason?: string | null;
          collections_assignee_id?: string | null;
          collections_received_at?: string | null;
          dispute_category?: string | null;
          dispute_opened_by?: string | null;
          dispute_resolved_at?: string | null;
          dispute_resolution?: string | null;
          escalated_at?: string | null;
          collections_completed_at?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          file_id?: string | null;
          provenance?: string;
          legacy_file_reference?: string | null;
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
          submitted_by?: string | null;
          submitted_at?: string | null;
          validated_by?: string | null;
          validated_at?: string | null;
          rejected_by?: string | null;
          rejected_at?: string | null;
          rejection_reason?: string | null;
          revision?: number;
          disputed_at?: string | null;
          dispute_reason?: string | null;
          collections_assignee_id?: string | null;
          collections_received_at?: string | null;
          dispute_category?: string | null;
          dispute_opened_by?: string | null;
          dispute_resolved_at?: string | null;
          dispute_resolution?: string | null;
          escalated_at?: string | null;
          collections_completed_at?: string | null;
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
      quotation_request: {
        Row: { id: string; tenant_id: string; client_id: string; reference: string | null; subject: string | null; triage_item_id: string | null; status: string; opened_by: string | null; closed_at: string | null; closure_reason: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; client_id: string; reference?: string | null; subject?: string | null; triage_item_id?: string | null; status?: string; opened_by?: string | null };
        Update: { status?: string; reference?: string | null; subject?: string | null; closed_at?: string | null; closure_reason?: string | null };
        Relationships: [];
      };
      quotation: {
        Row: { id: string; tenant_id: string; request_id: string; client_id: string; quotation_number: string | null; version: number; supersedes_id: string | null; status: string; currency: string; terms: string | null; validity_note: string | null; prepared_by: string | null; submitted_at: string | null; validated_by: string | null; validated_at: string | null; rejection_reason_code: string | null; sent_by: string | null; sent_at: string | null; acceptance_kind: string | null; accepted_on: string | null; acceptance_recorded_by: string | null; acceptance_document_id: string | null; acceptance_message_id: string | null; declined_on: string | null; decline_reason_code: string | null; converted_file_id: string | null; converted_at: string | null; converted_by: string | null; cancelled_at: string | null; cancellation_reason_code: string | null; artifact_storage_path: string | null; artifact_sha256: string | null; artifact_renderer_version: string | null; artifact_generated_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; request_id: string; client_id: string; version?: number; supersedes_id?: string | null; status?: string; currency?: string; terms?: string | null; validity_note?: string | null; prepared_by?: string | null };
        Update: { status?: string; terms?: string | null; validity_note?: string | null; artifact_storage_path?: string | null; artifact_sha256?: string | null; artifact_renderer_version?: string | null; artifact_generated_at?: string | null };
        Relationships: [];
      };
      quotation_line: {
        Row: { id: string; tenant_id: string; quotation_id: string; position: number; description: string; quantity_milli: number; unit_amount_minor: number; tax_rate_bp: number; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; quotation_id: string; position: number; description: string; quantity_milli: number; unit_amount_minor: number; tax_rate_bp?: number };
        Update: { description?: string; quantity_milli?: number; unit_amount_minor?: number; tax_rate_bp?: number; position?: number };
        Relationships: [];
      };
      quotation_counter: {
        Row: { tenant_id: string; year: number; next_seq: number };
        Insert: { tenant_id: string; year: number; next_seq?: number };
        Update: { next_seq?: number };
        Relationships: [];
      };
      ec_mailbox: {
        Row: { id: string; tenant_id: string; address: string; label_fr: string; purpose: string; is_active: boolean; note: string | null; created_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; address: string; label_fr: string; purpose?: string; is_active?: boolean; note?: string | null; created_by?: string | null };
        Update: { label_fr?: string; purpose?: string; is_active?: boolean; note?: string | null };
        Relationships: [];
      };
      ec_webhook_event: {
        Row: { id: string; tenant_id: string | null; provider: string; provider_event_id: string; signature_valid: boolean; outcome: string; detail: string | null; received_at: string };
        Insert: { id?: string; tenant_id?: string | null; provider: string; provider_event_id: string; signature_valid: boolean; outcome: string; detail?: string | null };
        Update: Record<string, never>;
        Relationships: [];
      };
      ec_inbound_message: {
        Row: { id: string; tenant_id: string | null; mailbox_id: string | null; provider: string; provider_event_id: string; provider_message_id: string | null; message_id: string | null; in_reply_to: string | null; references_header: string | null; thread_key: string | null; from_address: string; from_name: string | null; to_addresses: Json; cc_addresses: Json; subject: string | null; raw_sha256: string; raw_storage_path: string; raw_size_bytes: number; headers: Json; text_body_path: string | null; html_body_path: string | null; received_at: string; captured_at: string; capture_status: string; quarantine_reason: string | null };
        Insert: { id?: string; tenant_id?: string | null; mailbox_id?: string | null; provider: string; provider_event_id: string; provider_message_id?: string | null; message_id?: string | null; in_reply_to?: string | null; references_header?: string | null; thread_key?: string | null; from_address: string; from_name?: string | null; to_addresses?: Json; cc_addresses?: Json; subject?: string | null; raw_sha256: string; raw_storage_path: string; raw_size_bytes: number; headers?: Json; text_body_path?: string | null; html_body_path?: string | null; received_at: string; capture_status?: string; quarantine_reason?: string | null };
        Update: Record<string, never>;
        Relationships: [];
      };
      ec_inbound_attachment: {
        Row: { id: string; tenant_id: string | null; message_id: string; filename: string; original_filename: string | null; mime_type: string | null; size_bytes: number; sha256: string | null; storage_path: string | null; stored: boolean; rejection_reason: string | null; created_at: string };
        Insert: { id?: string; tenant_id?: string | null; message_id: string; filename: string; original_filename?: string | null; mime_type?: string | null; size_bytes?: number; sha256?: string | null; storage_path?: string | null; stored?: boolean; rejection_reason?: string | null };
        Update: Record<string, never>;
        Relationships: [];
      };
      ec_triage_item: {
        Row: { id: string; tenant_id: string | null; message_id: string; status: string; assigned_to: string | null; assigned_at: string | null; resolved_at: string | null; note: string | null; created_at: string; updated_at: string; outcome: string | null; outcome_file_id: string | null; outcome_client_id: string | null; discard_reason_code: string | null; outcome_comment: string | null; outcome_recorded_by: string | null; outcome_recorded_at: string | null };
        Insert: { id?: string; tenant_id?: string | null; message_id: string; status?: string; assigned_to?: string | null; assigned_at?: string | null; note?: string | null };
        Update: { status?: string; assigned_to?: string | null; assigned_at?: string | null; resolved_at?: string | null; note?: string | null; outcome?: string | null; outcome_file_id?: string | null; outcome_client_id?: string | null; discard_reason_code?: string | null; outcome_comment?: string | null; outcome_recorded_by?: string | null; outcome_recorded_at?: string | null };
        Relationships: [];
      };
      tenant_ec_inbound_rollout: {
        Row: { tenant_id: string; enabled: boolean; note: string | null; first_enabled_at: string | null; updated_at: string; updated_by: string | null };
        Insert: { tenant_id: string; enabled?: boolean; note?: string | null; first_enabled_at?: string | null; updated_by?: string | null };
        Update: { enabled?: boolean; note?: string | null; first_enabled_at?: string | null; updated_by?: string | null };
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
          quotation_id: string | null;
          conversation_id: string | null;
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
          quotation_id?: string | null;
          conversation_id?: string | null;
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
          quotation_id?: string | null;
          conversation_id?: string | null;
          dedup_key?: string;
          read_at?: string | null;
          archived_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // Phase 8.7 — Effitrans Messaging Center (supabase/migrations/20260722000001_messaging_center.sql).
      conversation: {
        Row: {
          id: string;
          tenant_id: string;
          type: string;
          title: string | null;
          client_id: string | null;
          file_id: string | null;
          department_code: string | null;
          status: string;
          priority: string;
          assigned_to: string | null;
          created_by: string | null;
          created_by_client_user_id: string | null;
          created_at: string;
          updated_at: string;
          closed_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          type: string;
          title?: string | null;
          client_id?: string | null;
          file_id?: string | null;
          department_code?: string | null;
          status?: string;
          priority?: string;
          assigned_to?: string | null;
          created_by?: string | null;
          created_by_client_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
          closed_at?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          type?: string;
          title?: string | null;
          client_id?: string | null;
          file_id?: string | null;
          department_code?: string | null;
          status?: string;
          priority?: string;
          assigned_to?: string | null;
          created_by?: string | null;
          created_by_client_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
          closed_at?: string | null;
        };
        Relationships: [];
      };
      conversation_participant: {
        Row: {
          id: string;
          tenant_id: string;
          conversation_id: string;
          participant_type: string;
          user_id: string | null;
          client_user_id: string | null;
          department_code: string | null;
          joined_at: string;
          last_read_at: string | null;
          muted_at: string | null;
          removed_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          conversation_id: string;
          participant_type: string;
          user_id?: string | null;
          client_user_id?: string | null;
          department_code?: string | null;
          joined_at?: string;
          last_read_at?: string | null;
          muted_at?: string | null;
          removed_at?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          conversation_id?: string;
          participant_type?: string;
          user_id?: string | null;
          client_user_id?: string | null;
          department_code?: string | null;
          joined_at?: string;
          last_read_at?: string | null;
          muted_at?: string | null;
          removed_at?: string | null;
        };
        Relationships: [];
      };
      message: {
        Row: {
          id: string;
          tenant_id: string;
          conversation_id: string;
          sender_type: string;
          sender_user_id: string | null;
          sender_client_user_id: string | null;
          body: string;
          message_type: string;
          visibility: string;
          reply_to_message_id: string | null;
          created_at: string;
          redacted_at: string | null;
          redacted_by: string | null;
          redaction_reason: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          conversation_id: string;
          sender_type: string;
          sender_user_id?: string | null;
          sender_client_user_id?: string | null;
          body: string;
          message_type?: string;
          visibility?: string;
          reply_to_message_id?: string | null;
          created_at?: string;
          redacted_at?: string | null;
          redacted_by?: string | null;
          redaction_reason?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          conversation_id?: string;
          sender_type?: string;
          sender_user_id?: string | null;
          sender_client_user_id?: string | null;
          body?: string;
          message_type?: string;
          visibility?: string;
          reply_to_message_id?: string | null;
          created_at?: string;
          redacted_at?: string | null;
          redacted_by?: string | null;
          redaction_reason?: string | null;
        };
        Relationships: [];
      };
      message_attachment: {
        Row: {
          id: string;
          tenant_id: string;
          message_id: string;
          storage_path: string;
          original_filename: string;
          mime_type: string;
          size_bytes: number;
          uploaded_by_user_id: string | null;
          uploaded_by_client_user_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          message_id: string;
          storage_path: string;
          original_filename: string;
          mime_type: string;
          size_bytes: number;
          uploaded_by_user_id?: string | null;
          uploaded_by_client_user_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          message_id?: string;
          storage_path?: string;
          original_filename?: string;
          mime_type?: string;
          size_bytes?: number;
          uploaded_by_user_id?: string | null;
          uploaded_by_client_user_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      tenant_messaging_rollout: {
        Row: {
          tenant_id: string;
          enabled: boolean;
          note: string | null;
          first_enabled_at: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          tenant_id: string;
          enabled?: boolean;
          note?: string | null;
          first_enabled_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          tenant_id?: string;
          enabled?: boolean;
          note?: string | null;
          first_enabled_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      // Phase 9.0B — workflow structural extensions (20260723000001_workflow_structures.sql).
      process_decision: {
        Row: {
          id: string;
          tenant_id: string;
          process_instance_id: string;
          process_step_execution_id: string | null;
          decision_type: string;
          outcome: string | null;
          requested_by: string;
          requested_at: string;
          decided_by: string | null;
          decided_at: string | null;
          reason: string;
          conditions: string | null;
          expires_at: string | null;
          status: string;
          supersedes_decision_id: string | null;
          metadata: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          process_instance_id: string;
          process_step_execution_id?: string | null;
          decision_type: string;
          outcome?: string | null;
          requested_by: string;
          requested_at?: string;
          decided_by?: string | null;
          decided_at?: string | null;
          reason: string;
          conditions?: string | null;
          expires_at?: string | null;
          status?: string;
          supersedes_decision_id?: string | null;
          metadata?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          outcome?: string | null;
          decided_by?: string | null;
          decided_at?: string | null;
          conditions?: string | null;
          expires_at?: string | null;
          status?: string;
          metadata?: Json | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      process_blocker: {
        Row: {
          id: string;
          tenant_id: string;
          process_instance_id: string;
          process_step_execution_id: string | null;
          category: string;
          title: string;
          description: string | null;
          severity: string;
          source_department_code: string | null;
          owner_user_id: string | null;
          status: string;
          opened_by: string;
          opened_at: string;
          resolved_by: string | null;
          resolved_at: string | null;
          resolution_note: string | null;
          customer_visible: boolean;
          customer_message: string | null;
          due_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          process_instance_id: string;
          process_step_execution_id?: string | null;
          category: string;
          title: string;
          description?: string | null;
          severity?: string;
          source_department_code?: string | null;
          owner_user_id?: string | null;
          status?: string;
          opened_by: string;
          opened_at?: string;
          resolved_by?: string | null;
          resolved_at?: string | null;
          resolution_note?: string | null;
          customer_visible?: boolean;
          customer_message?: string | null;
          due_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          category?: string;
          title?: string;
          description?: string | null;
          severity?: string;
          source_department_code?: string | null;
          owner_user_id?: string | null;
          status?: string;
          resolved_by?: string | null;
          resolved_at?: string | null;
          resolution_note?: string | null;
          customer_visible?: boolean;
          customer_message?: string | null;
          due_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_team_member: {
        Row: {
          id: string;
          tenant_id: string;
          team_code: string;
          app_user_id: string;
          active: boolean;
          assigned_at: string;
          assigned_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          team_code: string;
          app_user_id: string;
          active?: boolean;
          assigned_at?: string;
          assigned_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          assigned_at?: string;
          assigned_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      finance_request: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string;
          customs_record_id: string | null;
          process_decision_id: string | null;
          category: string;
          amount: number;
          currency: string;
          purpose: string;
          beneficiary: string;
          reimbursable: boolean;
          status: string;
          requested_by: string;
          requested_at: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          review_note: string | null;
          disbursed_amount: number | null;
          disbursement_method: string | null;
          disbursement_reference: string | null;
          disbursed_at: string | null;
          disbursed_by: string | null;
          evidence_status: string;
          evidence_document_id: string | null;
          evidence_verified_by: string | null;
          evidence_verified_at: string | null;
          evidence_note: string | null;
          billing_charge_id: string | null;
          dedup_key: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          file_id: string;
          customs_record_id?: string | null;
          process_decision_id?: string | null;
          category: string;
          amount: number;
          currency?: string;
          purpose: string;
          beneficiary: string;
          reimbursable?: boolean;
          status?: string;
          requested_by: string;
          requested_at?: string;
          dedup_key?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: string;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          review_note?: string | null;
          disbursed_amount?: number | null;
          disbursement_method?: string | null;
          disbursement_reference?: string | null;
          disbursed_at?: string | null;
          disbursed_by?: string | null;
          evidence_status?: string;
          evidence_document_id?: string | null;
          evidence_verified_by?: string | null;
          evidence_verified_at?: string | null;
          evidence_note?: string | null;
          billing_charge_id?: string | null;
          reimbursable?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      employee: {
        Row: {
          id: string;
          tenant_id: string;
          employee_number: string;
          linked_app_user_id: string | null;
          first_name: string;
          last_name: string;
          preferred_name: string | null;
          professional_email: string | null;
          personal_email: string | null;
          professional_phone: string | null;
          personal_phone: string | null;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          department: string;
          job_title: string | null;
          manager_employee_id: string | null;
          work_location: string | null;
          employment_type: string | null;
          hire_date: string | null;
          probation_end_date: string | null;
          termination_date: string | null;
          termination_reason: string | null;
          status: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          employee_number: string;
          linked_app_user_id?: string | null;
          first_name: string;
          last_name: string;
          preferred_name?: string | null;
          professional_email?: string | null;
          personal_email?: string | null;
          professional_phone?: string | null;
          personal_phone?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          department: string;
          job_title?: string | null;
          manager_employee_id?: string | null;
          work_location?: string | null;
          employment_type?: string | null;
          hire_date?: string | null;
          probation_end_date?: string | null;
          termination_date?: string | null;
          termination_reason?: string | null;
          status?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          linked_app_user_id?: string | null;
          first_name?: string;
          last_name?: string;
          preferred_name?: string | null;
          professional_email?: string | null;
          personal_email?: string | null;
          professional_phone?: string | null;
          personal_phone?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          department?: string;
          job_title?: string | null;
          manager_employee_id?: string | null;
          work_location?: string | null;
          employment_type?: string | null;
          hire_date?: string | null;
          probation_end_date?: string | null;
          termination_date?: string | null;
          termination_reason?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      employee_counter: {
        Row: { tenant_id: string; year: number; next_seq: number };
        Insert: { tenant_id: string; year: number; next_seq?: number };
        Update: { next_seq?: number };
        Relationships: [];
      };
      // HR-1 — Organization Foundation (migration 73). All dark-first.
      hr_configuration: {
        Row: {
          id: string; tenant_id: string; status: string;
          employee_number_keep_existing: boolean; employee_number_prefix: string | null;
          employment_kinds: unknown; termination_reasons: unknown;
          activated_by: string | null; activated_at: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; tenant_id: string; status?: string;
          employee_number_keep_existing?: boolean; employee_number_prefix?: string | null;
          employment_kinds?: unknown; termination_reasons?: unknown;
          activated_by?: string | null; activated_at?: string | null;
        };
        Update: {
          status?: string; employee_number_keep_existing?: boolean;
          employee_number_prefix?: string | null; employment_kinds?: unknown;
          termination_reasons?: unknown; activated_by?: string | null; activated_at?: string | null;
        };
        Relationships: [];
      };
      hr_org_unit: {
        Row: {
          id: string; tenant_id: string; parent_id: string | null; unit_kind: string;
          name: string; code: string | null; canonical_department: string | null;
          is_active: boolean; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; tenant_id: string; parent_id?: string | null; unit_kind: string;
          name: string; code?: string | null; canonical_department?: string | null;
          is_active?: boolean;
        };
        Update: {
          parent_id?: string | null; unit_kind?: string; name?: string; code?: string | null;
          canonical_department?: string | null; is_active?: boolean;
        };
        Relationships: [];
      };
      hr_position: {
        Row: {
          id: string; tenant_id: string; title: string; code: string | null;
          description: string | null; is_active: boolean; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; tenant_id: string; title: string; code?: string | null;
          description?: string | null; is_active?: boolean;
        };
        Update: { title?: string; code?: string | null; description?: string | null; is_active?: boolean };
        Relationships: [];
      };
      hr_work_location: {
        Row: {
          id: string; tenant_id: string; name: string; city: string | null; country: string;
          is_active: boolean; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; tenant_id: string; name: string; city?: string | null; country?: string;
          is_active?: boolean;
        };
        Update: { name?: string; city?: string | null; country?: string; is_active?: boolean };
        Relationships: [];
      };
      employee_assignment: {
        Row: {
          id: string; tenant_id: string; employee_id: string;
          org_unit_id: string | null; position_id: string | null; work_location_id: string | null;
          manager_employee_id: string | null; assignment_kind: string;
          effective_from: string; effective_to: string | null; note: string | null;
          created_by: string | null; created_at: string;
        };
        Insert: {
          id?: string; tenant_id: string; employee_id: string;
          org_unit_id?: string | null; position_id?: string | null; work_location_id?: string | null;
          manager_employee_id?: string | null; assignment_kind?: string;
          effective_from?: string; effective_to?: string | null; note?: string | null;
          created_by?: string | null;
        };
        Update: { effective_to?: string | null; note?: string | null };
        Relationships: [];
      };
      hr_employee_event: {
        Row: {
          id: string; tenant_id: string; employee_id: string; event_kind: string;
          occurred_at: string; actor_id: string | null; payload: unknown; created_at: string;
        };
        Insert: {
          id?: string; tenant_id: string; employee_id: string; event_kind: string;
          occurred_at?: string; actor_id?: string | null; payload?: unknown;
        };
        Update: never;
        Relationships: [];
      };
      hr_import_batch: {
        Row: {
          id: string; tenant_id: string; batch_number: string; import_kind: string;
          source_filename: string | null; source_file_sha256: string | null; status: string;
          mapping: unknown; row_count: number; error_count: number;
          prepared_by: string | null; prepared_at: string;
          submitted_by: string | null; submitted_at: string | null;
          approved_by: string | null; approved_at: string | null;
          rejection_reason: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; tenant_id: string; batch_number: string; import_kind: string;
          source_filename?: string | null; source_file_sha256?: string | null; status?: string;
          mapping?: unknown; row_count?: number; error_count?: number;
          prepared_by?: string | null;
        };
        Update: {
          status?: string; mapping?: unknown; row_count?: number; error_count?: number;
          submitted_by?: string | null; submitted_at?: string | null;
          approved_by?: string | null; approved_at?: string | null;
          rejection_reason?: string | null;
        };
        Relationships: [];
      };
      hr_import_staging_row: {
        Row: {
          id: string; tenant_id: string; batch_id: string; source_row_number: number;
          raw: unknown; parsed: unknown; status: string;
        };
        Insert: {
          id?: string; tenant_id: string; batch_id: string; source_row_number: number;
          raw: unknown; parsed?: unknown; status?: string;
        };
        Update: { parsed?: unknown; status?: string };
        Relationships: [];
      };
      hr_leave_category: {
        Row: { id: string; tenant_id: string; code: string; label_fr: string; is_paid: boolean | null; requires_evidence: boolean; is_provisional: boolean; is_active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; code: string; label_fr: string; is_paid?: boolean | null; requires_evidence?: boolean; is_provisional?: boolean; is_active?: boolean };
        Update: { label_fr?: string; is_paid?: boolean | null; requires_evidence?: boolean; is_provisional?: boolean; is_active?: boolean };
        Relationships: [];
      };
      hr_leave_entitlement: {
        Row: { id: string; tenant_id: string; employee_id: string; category_id: string; period_start: string; period_end: string; opening_tenths: number; accrued_tenths: number; taken_tenths: number; note: string | null; created_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; employee_id: string; category_id: string; period_start: string; period_end: string; opening_tenths?: number; accrued_tenths?: number; taken_tenths?: number; note?: string | null; created_by?: string | null };
        Update: { opening_tenths?: number; accrued_tenths?: number; taken_tenths?: number; note?: string | null; period_end?: string };
        Relationships: [];
      };
      hr_leave_request: {
        Row: { id: string; tenant_id: string; employee_id: string; category_id: string; status: string; start_date: string; end_date: string; day_tenths: number; reason: string | null; evidence_document_id: string | null; requested_by: string; submitted_at: string | null; approved_by: string | null; decided_at: string | null; decision_note: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; employee_id: string; category_id: string; status?: string; start_date: string; end_date: string; day_tenths: number; reason?: string | null; evidence_document_id?: string | null; requested_by: string };
        Update: { status?: string; submitted_at?: string | null; decision_note?: string | null; evidence_document_id?: string | null };
        Relationships: [];
      };
      hr_attendance_day: {
        Row: { id: string; tenant_id: string; employee_id: string; work_date: string; worked_minutes: number; source: string; note: string | null; recorded_by: string | null; recorded_at: string };
        Insert: { id?: string; tenant_id: string; employee_id: string; work_date: string; worked_minutes: number; source?: string; note?: string | null; recorded_by?: string | null };
        Update: { worked_minutes?: number; source?: string; note?: string | null };
        Relationships: [];
      };
      hr_performance_cycle: {
        Row: { id: string; tenant_id: string; code: string; label_fr: string; cycle_kind: string; status: string; period_start: string; period_end: string; opens_on: string | null; submission_deadline: string | null; review_deadline: string | null; finalized_at: string | null; cancelled_at: string | null; cancellation_reason: string | null; hr_owner_id: string | null; target_scope: string; target_org_unit_id: string | null; target_position_id: string | null; weight_total_bp: number; created_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; code: string; label_fr: string; cycle_kind: string; status?: string; period_start: string; period_end: string; opens_on?: string | null; submission_deadline?: string | null; review_deadline?: string | null; hr_owner_id?: string | null; target_scope?: string; target_org_unit_id?: string | null; target_position_id?: string | null; weight_total_bp?: number; created_by?: string | null };
        Update: { status?: string; label_fr?: string; submission_deadline?: string | null; review_deadline?: string | null; finalized_at?: string | null; cancelled_at?: string | null; cancellation_reason?: string | null; hr_owner_id?: string | null };
        Relationships: [];
      };
      hr_competency: {
        Row: { id: string; tenant_id: string; code: string; label_fr: string; description: string | null; category: string | null; scale_min: number; scale_max: number; scale_labels: Record<string, string>; is_active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; code: string; label_fr: string; description?: string | null; category?: string | null; scale_min?: number; scale_max?: number; scale_labels?: Record<string, string>; is_active?: boolean };
        Update: { code?: string; label_fr?: string; description?: string | null; category?: string | null; scale_min?: number; scale_max?: number; scale_labels?: Record<string, string>; is_active?: boolean; tenant_id?: string };
        Relationships: [];
      };
      hr_competency_expectation: {
        Row: { id: string; tenant_id: string; position_id: string; competency_id: string; expected_level: number; created_at: string };
        Insert: { id?: string; tenant_id: string; position_id: string; competency_id: string; expected_level: number };
        Update: { expected_level?: number };
        Relationships: [];
      };
      hr_evaluation: {
        Row: { id: string; tenant_id: string; cycle_id: string; employee_id: string; manager_employee_id: string | null; status: string; self_comments: string | null; self_entered_by: string | null; self_submitted_at: string | null; manager_comments: string | null; manager_strengths: string | null; manager_development: string | null; recommended_actions: string | null; manager_entered_by: string | null; manager_submitted_at: string | null; moderation_note: string | null; final_summary: string | null; finalized_by: string | null; finalized_at: string | null; acknowledged_by: string | null; acknowledged_at: string | null; acknowledgment_note: string | null; cancelled_at: string | null; cancellation_reason: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; cycle_id: string; employee_id: string; manager_employee_id?: string | null; status?: string };
        Update: { status?: string; cancelled_at?: string | null; cancellation_reason?: string | null };
        Relationships: [];
      };
      hr_objective: {
        Row: { id: string; tenant_id: string; cycle_id: string; employee_id: string; title: string; description: string | null; category: string | null; weight_bp: number; measurable_target: string | null; due_date: string | null; status: string; progress_bp: number; manager_achievement_bp: number | null; manager_assessment: string | null; completion_note: string | null; evidence_document_id: string | null; version: number; supersedes_objective_id: string | null; locked_at: string | null; created_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; cycle_id: string; employee_id: string; title: string; description?: string | null; category?: string | null; weight_bp?: number; measurable_target?: string | null; due_date?: string | null; status?: string; created_by?: string | null };
        Update: { status?: string; progress_bp?: number; manager_achievement_bp?: number | null; manager_assessment?: string | null; completion_note?: string | null; evidence_document_id?: string | null; locked_at?: string | null };
        Relationships: [];
      };
      hr_competency_assessment: {
        Row: { id: string; tenant_id: string; evaluation_id: string; competency_id: string; self_level: number | null; manager_level: number | null; expected_level: number | null; note: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; evaluation_id: string; competency_id: string; self_level?: number | null; manager_level?: number | null; expected_level?: number | null; note?: string | null };
        Update: { self_level?: number | null; manager_level?: number | null; expected_level?: number | null; note?: string | null; tenant_id?: string; evaluation_id?: string; competency_id?: string };
        Relationships: [];
      };
      hr_training_course: {
        Row: { id: string; tenant_id: string; code: string; title: string; provider: string | null; category: string | null; delivery_mode: string; duration_minutes: number | null; validity_months: number | null; is_mandatory: boolean; target_org_unit_id: string | null; target_position_id: string | null; requires_evidence: boolean; is_active: boolean; created_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; code: string; title: string; provider?: string | null; category?: string | null; delivery_mode?: string; duration_minutes?: number | null; validity_months?: number | null; is_mandatory?: boolean; target_org_unit_id?: string | null; target_position_id?: string | null; requires_evidence?: boolean; is_active?: boolean; created_by?: string | null };
        Update: { code?: string; title?: string; provider?: string | null; category?: string | null; delivery_mode?: string; duration_minutes?: number | null; validity_months?: number | null; is_mandatory?: boolean; target_org_unit_id?: string | null; target_position_id?: string | null; requires_evidence?: boolean; is_active?: boolean; tenant_id?: string };
        Relationships: [];
      };
      hr_training_plan: {
        Row: { id: string; tenant_id: string; employee_id: string; label_fr: string; period_start: string; period_end: string; status: string; note: string | null; created_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; employee_id: string; label_fr: string; period_start: string; period_end: string; status?: string; note?: string | null; created_by?: string | null };
        Update: { status?: string; label_fr?: string; note?: string | null };
        Relationships: [];
      };
      hr_training_enrollment: {
        Row: { id: string; tenant_id: string; employee_id: string; course_id: string; plan_id: string | null; status: string; planned_date: string | null; due_date: string | null; started_at: string | null; completed_on: string | null; result: string | null; certificate_document_id: string | null; expiry_date: string | null; provider_reference: string | null; note: string | null; cancellation_reason: string | null; assigned_by: string | null; completed_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; employee_id: string; course_id: string; plan_id?: string | null; status?: string; planned_date?: string | null; due_date?: string | null; assigned_by?: string | null; note?: string | null };
        Update: { status?: string; started_at?: string | null; planned_date?: string | null; due_date?: string | null; certificate_document_id?: string | null; note?: string | null };
        Relationships: [];
      };
      hr_checklist_template: {
        Row: { id: string; tenant_id: string; code: string; label_fr: string; is_active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; code: string; label_fr: string; is_active?: boolean };
        Update: { label_fr?: string; is_active?: boolean };
        Relationships: [];
      };
      hr_checklist_item_template: {
        Row: { id: string; tenant_id: string; template_id: string; position: number; label_fr: string; responsible_function: string | null; is_required: boolean; is_blocking: boolean; evidence_required: boolean; due_offset_days: number };
        Insert: { id?: string; tenant_id: string; template_id: string; position: number; label_fr: string; responsible_function?: string | null; is_required?: boolean; is_blocking?: boolean; evidence_required?: boolean; due_offset_days?: number };
        Update: { label_fr?: string; is_required?: boolean; is_blocking?: boolean; evidence_required?: boolean; due_offset_days?: number };
        Relationships: [];
      };
      hr_onboarding_case: {
        Row: { id: string; tenant_id: string; employee_id: string; template_id: string | null; status: string; planned_start_date: string | null; actual_start_date: string | null; hr_officer_id: string | null; manager_employee_id: string | null; work_location_id: string | null; position_id: string | null; completed_at: string | null; cancelled_at: string | null; cancellation_reason: string | null; summary: string | null; created_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; employee_id: string; template_id?: string | null; status?: string; planned_start_date?: string | null; actual_start_date?: string | null; hr_officer_id?: string | null; manager_employee_id?: string | null; work_location_id?: string | null; position_id?: string | null; summary?: string | null; created_by?: string | null };
        Update: { status?: string; planned_start_date?: string | null; actual_start_date?: string | null; hr_officer_id?: string | null; manager_employee_id?: string | null; work_location_id?: string | null; position_id?: string | null; completed_at?: string | null; cancelled_at?: string | null; cancellation_reason?: string | null; summary?: string | null };
        Relationships: [];
      };
      hr_onboarding_item: {
        Row: { id: string; tenant_id: string; case_id: string; item_template_id: string | null; position: number; label_fr: string; responsible_function: string | null; is_required: boolean; is_blocking: boolean; evidence_required: boolean; due_date: string | null; status: string; evidence_document_id: string | null; comment: string | null; completed_by: string | null; completed_at: string | null };
        Insert: { id?: string; tenant_id: string; case_id: string; item_template_id?: string | null; position: number; label_fr: string; responsible_function?: string | null; is_required?: boolean; is_blocking?: boolean; evidence_required?: boolean; due_date?: string | null; status?: string };
        Update: { status?: string; evidence_document_id?: string | null; comment?: string | null; completed_by?: string | null; completed_at?: string | null; due_date?: string | null };
        Relationships: [];
      };
      hr_provisioning_request: {
        Row: { id: string; tenant_id: string; case_id: string; kind: string; status: string; linked_app_user_id: string | null; note: string | null; requested_by: string | null; requested_at: string; completed_by: string | null; completed_at: string | null };
        Insert: { id?: string; tenant_id: string; case_id: string; kind: string; status?: string; linked_app_user_id?: string | null; note?: string | null; requested_by?: string | null };
        Update: { status?: string; linked_app_user_id?: string | null; note?: string | null; completed_by?: string | null; completed_at?: string | null };
        Relationships: [];
      };
      hr_equipment_type: {
        Row: { id: string; tenant_id: string; code: string; label_fr: string; is_active: boolean; created_at: string };
        Insert: { id?: string; tenant_id: string; code: string; label_fr: string; is_active?: boolean };
        Update: { label_fr?: string; is_active?: boolean };
        Relationships: [];
      };
      hr_equipment: {
        Row: { id: string; tenant_id: string; equipment_type_id: string; asset_tag: string; serial_number: string | null; description: string | null; condition: string; lifecycle_status: string; ownership_source: string; acquisition_date: string | null; is_active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; equipment_type_id: string; asset_tag: string; serial_number?: string | null; description?: string | null; condition?: string; lifecycle_status?: string; ownership_source?: string; acquisition_date?: string | null; is_active?: boolean };
        Update: { condition?: string; lifecycle_status?: string; description?: string | null; is_active?: boolean; serial_number?: string | null };
        Relationships: [];
      };
      hr_equipment_assignment: {
        Row: { id: string; tenant_id: string; equipment_id: string; employee_id: string; assigned_by: string | null; assigned_on: string; expected_return_date: string | null; returned_on: string | null; condition_at_issue: string | null; condition_at_return: string | null; return_outcome: string | null; acknowledgement_document_id: string | null; note: string | null; returned_by: string | null; created_at: string };
        Insert: { id?: string; tenant_id: string; equipment_id: string; employee_id: string; assigned_by?: string | null; expected_return_date?: string | null; condition_at_issue?: string | null; note?: string | null };
        Update: { acknowledgement_document_id?: string | null; note?: string | null };
        Relationships: [];
      };
      hr_document_type: {
        Row: { id: string; tenant_id: string; code: string; label_fr: string; data_class: string; has_validity: boolean; required_for_termination: boolean; is_active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; code: string; label_fr: string; data_class?: string; has_validity?: boolean; required_for_termination?: boolean; is_active?: boolean };
        Update: { label_fr?: string; data_class?: string; has_validity?: boolean; required_for_termination?: boolean; is_active?: boolean };
        Relationships: [];
      };
      hr_document: {
        Row: { id: string; tenant_id: string; employee_id: string; document_type_id: string; title: string; storage_path: string; mime_type: string | null; size_bytes: number | null; content_sha256: string | null; expiry_date: string | null; uploaded_by: string | null; uploaded_at: string; deleted_at: string | null };
        Insert: { id?: string; tenant_id: string; employee_id: string; document_type_id: string; title: string; storage_path: string; mime_type?: string | null; size_bytes?: number | null; content_sha256?: string | null; expiry_date?: string | null; uploaded_by?: string | null };
        Update: { deleted_at?: string | null; expiry_date?: string | null; title?: string };
        Relationships: [];
      };
      employment_contract: {
        Row: { id: string; tenant_id: string; employee_id: string; contract_kind: string; status: string; start_date: string; end_date: string | null; probation_end: string | null; document_id: string | null; prepared_by: string; verified_by: string | null; verified_at: string | null; ended_at: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; tenant_id: string; employee_id: string; contract_kind: string; status?: string; start_date: string; end_date?: string | null; probation_end?: string | null; document_id?: string | null; prepared_by: string };
        Update: { status?: string; end_date?: string | null; verified_by?: string | null; verified_at?: string | null; ended_at?: string | null };
        Relationships: [];
      };
      hr_template_version: {
        Row: { id: string; tenant_id: string; code: string; version: number; title: string; body_md: string; created_by: string | null; created_at: string };
        Insert: { id?: string; tenant_id: string; code: string; version: number; title: string; body_md: string; created_by?: string | null };
        Update: never;
        Relationships: [];
      };
      hr_import_error: {
        Row: {
          id: string; tenant_id: string; batch_id: string; staging_row_id: string | null;
          field: string | null; code: string; message_fr: string; created_at: string;
        };
        Insert: {
          id?: string; tenant_id: string; batch_id: string; staging_row_id?: string | null;
          field?: string | null; code: string; message_fr: string;
        };
        Update: never;
        Relationships: [];
      };
      // Phase 11.0B — Finance Expense Documents.
      expense_authorization: {
        Row: {
          id: string;
          tenant_id: string;
          authorization_number: string | null;
          file_id: string | null;
          finance_request_id: string | null;
          account_number: string | null;
          registration_number: string | null;
          expense_type: string | null;
          weight_kg: number | null;
          amount: number;
          currency: string;
          amount_in_words: string | null;
          beneficiary: string;
          reason: string;
          status: string;
          current_version_id: string | null;
          requested_by: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          authorization_number?: string | null;
          file_id?: string | null;
          finance_request_id?: string | null;
          account_number?: string | null;
          registration_number?: string | null;
          expense_type?: string | null;
          weight_kg?: number | null;
          amount: number;
          currency?: string;
          amount_in_words?: string | null;
          beneficiary: string;
          reason: string;
          status?: string;
          current_version_id?: string | null;
          requested_by: string;
          created_by?: string | null;
        };
        Update: {
          authorization_number?: string | null;
          file_id?: string | null;
          finance_request_id?: string | null;
          account_number?: string | null;
          registration_number?: string | null;
          expense_type?: string | null;
          weight_kg?: number | null;
          amount?: number;
          currency?: string;
          amount_in_words?: string | null;
          beneficiary?: string;
          reason?: string;
          status?: string;
          current_version_id?: string | null;
        };
        Relationships: [];
      };
      expense_authorization_version: {
        Row: {
          id: string;
          tenant_id: string;
          authorization_id: string;
          version_number: number;
          account_number: string | null;
          registration_number: string | null;
          expense_type: string | null;
          weight_kg: number | null;
          amount: number;
          currency: string;
          amount_in_words: string | null;
          beneficiary: string;
          reason: string;
          snapshot: Json;
          template_code: string | null;
          template_version: number | null;
          content_sha256: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          authorization_id: string;
          version_number: number;
          account_number?: string | null;
          registration_number?: string | null;
          expense_type?: string | null;
          weight_kg?: number | null;
          amount: number;
          currency: string;
          amount_in_words?: string | null;
          beneficiary: string;
          reason: string;
          snapshot: Json;
          template_code?: string | null;
          template_version?: number | null;
          content_sha256: string;
          created_by?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      expense_voucher: {
        Row: {
          id: string;
          tenant_id: string;
          authorization_id: string;
          source_authorization_version: number;
          voucher_number: string | null;
          account_number: string | null;
          registration_number: string | null;
          amount: number;
          currency: string;
          amount_in_words: string | null;
          beneficiary: string;
          reason: string;
          payment_method: string | null;
          status: string;
          current_version_id: string | null;
          entered_by: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          authorization_id: string;
          source_authorization_version: number;
          voucher_number?: string | null;
          account_number?: string | null;
          registration_number?: string | null;
          amount: number;
          currency?: string;
          amount_in_words?: string | null;
          beneficiary: string;
          reason: string;
          payment_method?: string | null;
          status?: string;
          current_version_id?: string | null;
          entered_by: string;
          created_by?: string | null;
        };
        Update: {
          voucher_number?: string | null;
          account_number?: string | null;
          registration_number?: string | null;
          amount?: number;
          currency?: string;
          amount_in_words?: string | null;
          beneficiary?: string;
          reason?: string;
          payment_method?: string | null;
          status?: string;
          current_version_id?: string | null;
        };
        Relationships: [];
      };
      expense_voucher_version: {
        Row: {
          id: string;
          tenant_id: string;
          voucher_id: string;
          version_number: number;
          account_number: string | null;
          registration_number: string | null;
          amount: number;
          currency: string;
          amount_in_words: string | null;
          beneficiary: string;
          reason: string;
          payment_method: string | null;
          snapshot: Json;
          template_code: string | null;
          template_version: number | null;
          content_sha256: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          voucher_id: string;
          version_number: number;
          account_number?: string | null;
          registration_number?: string | null;
          amount: number;
          currency: string;
          amount_in_words?: string | null;
          beneficiary: string;
          reason: string;
          payment_method?: string | null;
          snapshot: Json;
          template_code?: string | null;
          template_version?: number | null;
          content_sha256: string;
          created_by?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      expense_approval_attempt: {
        Row: {
          id: string;
          tenant_id: string;
          document_type: string;
          authorization_id: string | null;
          voucher_id: string | null;
          version_id: string;
          attempt_number: number;
          status: string;
          opened_by: string | null;
          opened_at: string;
          closed_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          document_type: string;
          authorization_id?: string | null;
          voucher_id?: string | null;
          version_id: string;
          attempt_number: number;
          status?: string;
          opened_by?: string | null;
        };
        Update: { status?: string; closed_at?: string | null };
        Relationships: [];
      };
      expense_visa: {
        Row: {
          id: string;
          tenant_id: string;
          document_type: string;
          authorization_id: string | null;
          voucher_id: string | null;
          version_id: string;
          attempt_id: string;
          step_code: string;
          step_ordinal: number;
          signer_user_id: string;
          signer_role_code: string;
          signer_display_name: string;
          decision: string;
          comment: string | null;
          content_sha256: string;
          audit_log_id: string | null;
          decided_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          document_type: string;
          authorization_id?: string | null;
          voucher_id?: string | null;
          version_id: string;
          attempt_id: string;
          step_code: string;
          step_ordinal: number;
          signer_user_id: string;
          signer_role_code: string;
          signer_display_name: string;
          decision: string;
          comment?: string | null;
          content_sha256: string;
          audit_log_id?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      // Phase WES-7 — versioned workflow policy registry (ADR-WES-012).
      workflow_policy_version: {
        Row: {
          id: string;
          tenant_id: string | null;
          version: number;
          policy_schema_version: number;
          status: string;
          document: unknown;
          content_sha256: string;
          validation_status: string;
          validation_errors: unknown | null;
          validated_at: string | null;
          validated_by: string | null;
          effective_from: string | null;
          activated_at: string | null;
          activated_by: string | null;
          activation_reason: string | null;
          retired_at: string | null;
          parent_version_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string | null;
          version: number;
          policy_schema_version: number;
          status?: string;
          document: unknown;
          content_sha256: string;
          validation_status?: string;
          validation_errors?: unknown | null;
          validated_at?: string | null;
          validated_by?: string | null;
          effective_from?: string | null;
          parent_version_id?: string | null;
          created_by?: string | null;
        };
        Update: {
          document?: unknown;
          content_sha256?: string;
          status?: string;
          validation_status?: string;
          validation_errors?: unknown | null;
          validated_at?: string | null;
          validated_by?: string | null;
          effective_from?: string | null;
        };
        Relationships: [];
      };
      // Phase WES-4F — protected review record. Append-only; holds the
      // free-text explanation that must never reach business_event.
      document_review: {
        Row: {
          id: string;
          tenant_id: string;
          document_id: string;
          file_id: string | null;
          document_version: number;
          action: string;
          reason_code: string | null;
          explanation: string | null;
          actor_user_id: string | null;
          uploader_user_id: string | null;
          maker_checker_required: boolean;
          is_override: boolean;
          policy_version_id: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Phase WES-5D — append-only evidence consumption. Written only by
      // reconcile_step_completion.
      evidence_consumption: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string | null;
          step_execution_id: string;
          step_key: string;
          document_id: string;
          document_version: number | null;
          content_sha256: string | null;
          policy_version_id: string | null;
          consumed_at: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Phase WES-3A — append-only assignment history. No Insert/Update types:
      // rows are written ONLY by the assign_* RPCs, in the same transaction as
      // the assignment itself, and a trigger blocks UPDATE and DELETE.
      assignment_event: {
        Row: {
          id: string;
          tenant_id: string;
          file_id: string | null;
          subject_type: string;
          subject_id: string;
          previous_user_id: string | null;
          new_user_id: string | null;
          actor_user_id: string | null;
          reason: string | null;
          reason_code: string | null;
          workflow_step_key: string | null;
          policy_version_id: string | null;
          provenance: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Phase WES-9 — immutable business event ledger (ADR-WES-014).
      // No Update type: the table is append-only and a trigger blocks UPDATE
      // and DELETE for every role. There is no Insert type either — rows are
      // created ONLY by emit_business_event() from DB triggers and RPCs, never
      // by the application, and omitting Insert makes that unrepresentable in
      // TypeScript rather than merely discouraged.
      business_event: {
        Row: {
          id: string;
          tenant_id: string;
          event_type: string;
          event_domain: string;
          event_version: number;
          source: string;
          dossier_id: string | null;
          subject_type: string;
          subject_id: string | null;
          actor_user_id: string | null;
          correlation_id: string | null;
          causation_id: string | null;
          metadata: Record<string, string | number | boolean> | null;
          policy_version_id: string | null;
          policy_provenance: string | null;
          occurred_at: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Phase 11.0C — finance-classified supporting documents (DEC-C22).
      expense_attachment: {
        Row: {
          id: string;
          tenant_id: string;
          document_type: string;
          authorization_id: string | null;
          voucher_id: string | null;
          kind: string | null;
          file_name: string;
          mime_type: string | null;
          byte_size: number | null;
          storage_path: string;
          checksum: string | null;
          retired_at: string | null;
          retired_by: string | null;
          uploaded_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          document_type: string;
          authorization_id?: string | null;
          voucher_id?: string | null;
          kind?: string | null;
          file_name: string;
          mime_type?: string | null;
          byte_size?: number | null;
          storage_path: string;
          checksum?: string | null;
          uploaded_by: string;
        };
        Update: {
          storage_path?: string;
          checksum?: string | null;
          kind?: string | null;
          retired_at?: string | null;
          retired_by?: string | null;
        };
        Relationships: [];
      };
      expense_template: {
        Row: {
          id: string;
          template_code: string;
          version: number;
          checksum: string | null;
          page_count: number | null;
          status: string;
          active_from: string | null;
          retired_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          template_code: string;
          version: number;
          checksum?: string | null;
          page_count?: number | null;
          status?: string;
          active_from?: string | null;
          retired_at?: string | null;
        };
        Update: {
          checksum?: string | null;
          page_count?: number | null;
          status?: string;
          active_from?: string | null;
          retired_at?: string | null;
        };
        Relationships: [];
      };
      expense_authorization_counter: {
        Row: { tenant_id: string; year: number; next_seq: number };
        Insert: { tenant_id: string; year: number; next_seq?: number };
        Update: { next_seq?: number };
        Relationships: [];
      };
      expense_voucher_counter: {
        Row: { tenant_id: string; year: number; next_seq: number };
        Insert: { tenant_id: string; year: number; next_seq?: number };
        Update: { next_seq?: number };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      quotation_create: { Args: { p_tenant: string; p_request: string; p_actor: string }; Returns: string };
      next_quotation_number: { Args: { p_tenant: string }; Returns: string };
      quotation_submit: { Args: { p_tenant: string; p_quotation: string; p_actor: string }; Returns: string };
      quotation_validate: { Args: { p_tenant: string; p_quotation: string; p_actor: string; p_decision: string; p_reason_code?: string | null }; Returns: string };
      quotation_send: { Args: { p_tenant: string; p_quotation: string; p_actor: string }; Returns: string };
      quotation_record_decision: { Args: { p_tenant: string; p_quotation: string; p_actor: string; p_decision: string; p_acceptance_kind?: string | null; p_on?: string | null; p_document?: string | null; p_message?: string | null; p_reason_code?: string | null }; Returns: string };
      quotation_revise: { Args: { p_tenant: string; p_quotation: string; p_actor: string }; Returns: string };
      quotation_cancel: { Args: { p_tenant: string; p_quotation: string; p_actor: string; p_reason_code: string }; Returns: string };
      quotation_record_conversion: { Args: { p_tenant: string; p_quotation: string; p_actor: string; p_file: string }; Returns: string };
      emit_business_event: { Args: { p_tenant_id: string; p_event_type: string; p_event_domain: string; p_source: string; p_subject_type: string; p_subject_id?: string | null; p_dossier_id?: string | null; p_actor_user_id?: string | null; p_metadata?: Json; p_causation_id?: string | null; p_event_version?: number }; Returns: string };
      ec_assign_triage: {
        Args: { p_tenant: string; p_item: string; p_actor: string; p_assignee: string };
        Returns: string;
      };
      ec_review_triage: {
        Args: { p_tenant: string; p_item: string; p_actor: string };
        Returns: string;
      };
      ec_resolve_triage: {
        Args: { p_tenant: string; p_item: string; p_actor: string; p_outcome: string; p_file_id?: string | null; p_client_id?: string | null; p_reason_code?: string | null; p_comment?: string | null };
        Returns: string;
      };
      hr_open_performance_cycle: {
        Args: { p_tenant: string; p_cycle: string; p_actor: string };
        Returns: number;
      };
      hr_submit_self_assessment: {
        Args: { p_tenant: string; p_evaluation: string; p_actor: string; p_comments: string | null };
        Returns: string;
      };
      hr_submit_manager_review: {
        Args: { p_tenant: string; p_evaluation: string; p_actor: string; p_comments: string | null; p_strengths?: string | null; p_development?: string | null; p_actions?: string | null };
        Returns: string;
      };
      hr_finalize_evaluation: {
        Args: { p_tenant: string; p_evaluation: string; p_actor: string; p_moderation_note?: string | null; p_final_summary?: string | null };
        Returns: string;
      };
      hr_acknowledge_evaluation: {
        Args: { p_tenant: string; p_evaluation: string; p_actor: string; p_note?: string | null };
        Returns: string;
      };
      hr_assign_objective: {
        Args: { p_tenant: string; p_cycle: string; p_employee: string; p_actor: string; p_title: string; p_weight_bp: number; p_description?: string | null; p_category?: string | null; p_target?: string | null; p_due?: string | null; p_supersedes?: string | null };
        Returns: string;
      };
      hr_assign_training: {
        Args: { p_tenant: string; p_employee: string; p_course: string; p_actor: string; p_planned?: string | null; p_due?: string | null; p_plan?: string | null };
        Returns: string;
      };
      hr_complete_training: {
        Args: { p_tenant: string; p_enrollment: string; p_actor: string; p_result?: string | null; p_completed_on?: string | null; p_certificate?: string | null; p_provider_reference?: string | null };
        Returns: string;
      };
      hr_close_training_enrollment: {
        Args: { p_tenant: string; p_enrollment: string; p_actor: string; p_status: string; p_reason?: string | null };
        Returns: string;
      };
      hr_decide_leave_request: {
        Args: { p_tenant: string; p_request: string; p_actor: string; p_decision: string; p_note?: string | null };
        Returns: string;
      };
      hr_cancel_leave_request: {
        Args: { p_tenant: string; p_request: string; p_actor: string; p_reason: string };
        Returns: string;
      };
      hr_assign_equipment: {
        Args: { p_tenant: string; p_equipment: string; p_employee: string; p_actor: string; p_expected_return?: string | null; p_condition?: string | null; p_note?: string | null };
        Returns: string;
      };
      hr_return_equipment: {
        Args: { p_tenant: string; p_assignment: string; p_actor: string; p_outcome: string; p_condition?: string | null; p_note?: string | null };
        Returns: string;
      };
      hr_complete_onboarding_item: {
        Args: { p_tenant: string; p_item: string; p_actor: string; p_status: string; p_evidence?: string | null; p_comment?: string | null };
        Returns: string;
      };
      hr_complete_onboarding: {
        Args: { p_tenant: string; p_case: string; p_actor: string };
        Returns: string;
      };
      get_user_permissions: {
        Args: { p_user: string };
        Returns: { code: string }[];
      };
      next_file_number: {
        Args: { p_tenant: string; p_type: string };
        Returns: string;
      };
      provision_tenant: {
        Args: { p_admin_auth_id: string; p_platform_actor_id: string; p_input: Json };
        Returns: Json;
      };
      // Phase WES-7 — atomic policy activation (retire previous + promote new).
      activate_workflow_policy: {
        Args: { p_version_id: string; p_actor: string | null; p_reason: string; p_schema_version: number };
        Returns: Json;
      };
      // Phase WES-3A — assignment + append-only history + business event, all
      // in ONE transaction. The application never writes these assignee columns
      // directly; that would be the dual write WES-9A prohibited.
      assign_task: {
        Args: {
          p_task_id: string;
          p_new_user_id: string | null;
          p_actor: string | null;
          p_reason_code: string;
          p_reason?: string | null;
          p_step_key?: string | null;
          p_policy_id?: string | null;
        };
        Returns: Json;
      };
      assign_process_step: {
        Args: {
          p_execution_id: string;
          p_new_user_id: string | null;
          p_actor: string | null;
          p_reason_code: string;
          p_reason?: string | null;
          p_policy_id?: string | null;
        };
        Returns: Json;
      };
      assign_operational_owner: {
        Args: {
          p_instance_id: string;
          p_new_user_id: string;
          p_actor: string | null;
          p_reason_code: string;
          p_reason?: string | null;
          p_policy_id?: string | null;
        };
        Returns: Json;
      };
      // Phase WES-4 — document status + protected review record + business
      // event in ONE transaction (WES-9A Model A).
      // Phase WES-4G — artifact row + supersession + event in ONE transaction.
      finalize_generated_artifact: {
        Args: {
          p_document_id: string;
          p_tenant_id: string;
          p_file_id: string;
          p_artifact_code: string;
          p_type_code: string;
          p_storage_path: string;
          p_content_sha256: string;
          p_source_sha256: string;
          p_source_snapshot: Json;
          p_renderer_version: string;
          p_provenance: string;
          p_actor: string | null;
          p_size_bytes?: number | null;
          p_policy_id?: string | null;
        };
        Returns: Json;
      };
      // Phase WES-5 — step transition + evidence consumption + event, ONE
      // transaction. Idempotent: COMPLETED returns already=true.
      // UAT-2B — allocate-once invoice artifact. Idempotent: returns the
      // existing document instead of inserting a second one.
      finalize_official_invoice: {
        Args: {
          p_document_id: string;
          p_tenant_id: string;
          p_file_id: string;
          p_invoice_id: string;
          p_invoice_number: string;
          p_storage_path: string;
          p_content_sha256: string;
          p_source_snapshot: Json;
          p_renderer_version: string;
          p_actor: string | null;
          p_size_bytes?: number | null;
        };
        Returns: Json;
      };
      reconcile_step_completion: {
        Args: {
          p_execution_id: string;
          p_tenant_id: string;
          p_fact_code: string;
          p_actor?: string | null;
          p_evidence_doc_id?: string | null;
          p_policy_id?: string | null;
          p_legacy?: boolean;
        };
        Returns: Json;
      };
      review_document: {
        Args: {
          p_document_id: string;
          p_action: string;
          p_actor: string | null;
          p_reason_code?: string | null;
          p_explanation?: string | null;
          p_maker_checker?: boolean;
          p_is_override?: boolean;
          p_policy_id?: string | null;
        };
        Returns: Json;
      };
      supersede_document: {
        Args: { p_old_id: string; p_new_id: string; p_actor: string | null; p_policy_id?: string | null };
        Returns: Json;
      };
      record_customs_release: {
        Args: {
          p_customs_id: string;
          p_bae_reference: string;
          p_actor: string | null;
          p_release_date?: string | null;
          p_policy_id?: string | null;
        };
        Returns: Json;
      };
      record_bae_reference: {
        Args: { p_customs_id: string; p_bae_reference: string; p_actor: string | null };
        Returns: Json;
      };
      next_invoice_number: {
        Args: { p_tenant: string };
        Returns: string;
      };
      next_employee_number: {
        Args: { p_tenant: string };
        Returns: string;
      };
      next_expense_authorization_number: {
        Args: { p_tenant: string };
        Returns: string;
      };
      next_expense_voucher_number: {
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
