// Wire types for /upstream/push, the server's ingestion path for agent-owned records.

package clientapi

// AgentNameQueryParam names the pushing agent on /upstream/push.
const AgentNameQueryParam = "agent_name"

// PushData is a batch for /upstream/push. Its keys match duty's upstream.PushData; only the
// record kinds this SDK models are carried (config items and their records, canaries and
// checks, no topology), and the server treats a missing kind as empty.
type PushData struct {
	Canaries                   []Canary                    `json:"canaries,omitempty"`
	Checks                     []Check                     `json:"checks,omitempty"`
	ConfigScrapers             []ConfigScraper             `json:"config_scrapers,omitempty"`
	ConfigAnalysis             []ConfigAnalysis            `json:"config_analysis,omitempty"`
	ConfigChanges              []ConfigChange              `json:"config_changes,omitempty"`
	ConfigItems                []ConfigItem                `json:"config_items,omitempty"`
	CheckStatuses              []CheckStatus               `json:"check_statuses,omitempty"`
	ConfigRelationships        []ConfigRelationship        `json:"config_relationships,omitempty"`
	ConfigItemsLastScrapedTime []ConfigItemLastScrapedTime `json:"config_items_last_scraped_time,omitempty"`
	Artifacts                  []Artifact                  `json:"artifacts,omitempty"`
}

// Count is the number of records in the batch.
func (p *PushData) Count() int {
	if p == nil {
		return 0
	}
	return len(p.Canaries) + len(p.Checks) + len(p.ConfigScrapers) + len(p.ConfigAnalysis) +
		len(p.ConfigChanges) + len(p.ConfigItems) + len(p.CheckStatuses) + len(p.ConfigRelationships) +
		len(p.ConfigItemsLastScrapedTime) + len(p.Artifacts)
}
