// Tests that a pushed config analysis keeps the JSON /upstream/push decodes.

package clientapi

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	ginkgo "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = ginkgo.Describe("PushData DTO", func() {
	ginkgo.It("encodes analyses under duty's upstream keys", func() {
		observed := time.Date(2026, 11, 27, 9, 30, 0, 0, time.UTC)
		id, configID := uuid.New(), uuid.New()
		data := PushData{ConfigAnalysis: []ConfigAnalysis{{
			ID: id, ConfigID: configID, Analyzer: "tls-version", Message: "TLS 1.0 enabled",
			Summary: "Weak TLS", Status: AnalysisStatusOpen, Severity: SeverityHigh,
			AnalysisType: AnalysisTypeSecurity, Analysis: map[string]any{"engine": "nuclei"},
			Source: "recon/nuclei", FirstObserved: &observed, LastObserved: &observed,
		}}}

		encoded, err := json.Marshal(data)
		Expect(err).ToNot(HaveOccurred())
		// duty declares ExternalID and ConfigType without JSON tags, so they travel under
		// their Go names.
		Expect(encoded).To(MatchJSON(`{"config_analysis":[{
			"id": "` + id.String() + `",
			"ExternalID": "",
			"ConfigType": "",
			"config_id": "` + configID.String() + `",
			"scraper_id": null,
			"analyzer": "tls-version",
			"message": "TLS 1.0 enabled",
			"summary": "Weak TLS",
			"status": "open",
			"severity": "high",
			"analysis_type": "security",
			"analysis": {"engine": "nuclei"},
			"source": "recon/nuclei",
			"first_observed": "2026-11-27T09:30:00Z",
			"last_observed": "2026-11-27T09:30:00Z"
		}]}`))
		Expect(data.Count()).To(Equal(1))
	})

	ginkgo.It("carries each modelled kind under duty's key and counts it", func() {
		data := PushData{
			Canaries: []Canary{{}}, Checks: []Check{{}}, ConfigScrapers: []ConfigScraper{{}},
			ConfigAnalysis: []ConfigAnalysis{{}}, ConfigChanges: []ConfigChange{{}}, ConfigItems: []ConfigItem{{}},
			CheckStatuses: []CheckStatus{{}}, ConfigRelationships: []ConfigRelationship{{}},
			ConfigItemsLastScrapedTime: []ConfigItemLastScrapedTime{{}}, Artifacts: []Artifact{{}},
		}

		encoded, err := json.Marshal(data)
		Expect(err).ToNot(HaveOccurred())
		var keys map[string]json.RawMessage
		Expect(json.Unmarshal(encoded, &keys)).To(Succeed())
		Expect(keys).To(HaveLen(10))
		Expect(keys).To(HaveKey("canaries"))
		Expect(keys).To(HaveKey("checks"))
		Expect(keys).To(HaveKey("config_scrapers"))
		Expect(keys).To(HaveKey("config_analysis"))
		Expect(keys).To(HaveKey("config_changes"))
		Expect(keys).To(HaveKey("config_items"))
		Expect(keys).To(HaveKey("check_statuses"))
		Expect(keys).To(HaveKey("config_relationships"))
		Expect(keys).To(HaveKey("config_items_last_scraped_time"))
		Expect(keys).To(HaveKey("artifacts"))
		Expect(data.Count()).To(Equal(10))
	})

	ginkgo.It("counts a nil batch as empty", func() {
		var data *PushData
		Expect(data.Count()).To(BeZero())
	})
})
