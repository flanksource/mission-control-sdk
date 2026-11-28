// Wire types for Mission Control's catalog responses that duty does not model: config trees,
// relationships, change listings and insight details. Selectors, search requests, config
// items and properties are generated from duty; see zz_generated.duty_*.go.

package clientapi

import (
	"time"

	"github.com/google/uuid"
)

const MaxSearchResourcesLimit = 1000

type ConfigTreeNode struct {
	ConfigItem `json:",inline"`
	EdgeType   string            `json:"edgeType,omitempty"`
	Relation   string            `json:"relation,omitempty"`
	Children   []*ConfigTreeNode `json:"children,omitempty"`
}

type CatalogRelationships struct {
	ID       uuid.UUID       `json:"id"`
	Incoming *ConfigTreeNode `json:"incoming"`
	Outgoing *ConfigTreeNode `json:"outgoing"`
}

type CatalogChangesSearchResponse struct {
	Summary map[string]int    `json:"summary,omitempty"`
	Total   int64             `json:"total,omitempty"`
	Changes []ConfigChangeRow `json:"changes,omitempty"`
}

type CatalogChangeConfig struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	ConfigClass string `json:"config_class"`
}

type CatalogChangeDetail struct {
	ID                string               `json:"id"`
	ConfigID          string               `json:"config_id"`
	ChangeType        string               `json:"change_type"`
	CreatedAt         *time.Time           `json:"created_at,omitempty"`
	ExternalCreatedBy *string              `json:"external_created_by,omitempty"`
	Source            *string              `json:"source,omitempty"`
	Diff              *string              `json:"diff,omitempty"`
	Details           map[string]any       `json:"details,omitempty"`
	Patches           any                  `json:"patches,omitempty"`
	CreatedBy         *uuid.UUID           `json:"created_by,omitempty"`
	Config            *CatalogChangeConfig `json:"config,omitempty"`
	Artifacts         []map[string]any     `json:"artifacts,omitempty"`
}

type CatalogInsightDetail struct {
	ID            uuid.UUID                `json:"id"`
	ConfigID      uuid.UUID                `json:"config_id"`
	ScraperID     *uuid.UUID               `json:"scraper_id,omitempty"`
	Analyzer      string                   `json:"analyzer"`
	Message       string                   `json:"message,omitempty"`
	Summary       string                   `json:"summary,omitempty"`
	Status        string                   `json:"status,omitempty"`
	Severity      string                   `json:"severity,omitempty"`
	AnalysisType  string                   `json:"analysis_type,omitempty"`
	Analysis      map[string]any           `json:"analysis,omitempty"`
	Properties    *CatalogProperties       `json:"properties,omitempty"`
	Source        string                   `json:"source,omitempty"`
	FirstObserved *time.Time               `json:"first_observed,omitempty"`
	LastObserved  *time.Time               `json:"last_observed,omitempty"`
	IsPushed      bool                     `json:"is_pushed,omitempty"`
	Config        *CatalogChangeConfig     `json:"config,omitempty"`
	Evidences     []CatalogInsightEvidence `json:"evidences,omitempty"`
}

type CatalogInsightEvidence struct {
	Hypothesis *CatalogInsightHypothesis `json:"hypothesis,omitempty"`
}

type CatalogInsightHypothesis struct {
	Incident *CatalogInsightIncident `json:"incident,omitempty"`
}

type CatalogInsightIncident struct {
	IncidentID string `json:"incident_id,omitempty"`
}
