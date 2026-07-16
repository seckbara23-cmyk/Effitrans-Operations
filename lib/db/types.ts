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
      provision_tenant: {
        Args: { p_admin_auth_id: string; p_platform_actor_id: string; p_input: Json };
        Returns: Json;
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
