package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

const (
	StatusOpen   = "open"
	StatusClosed = "closed"
)

type Severity string

const (
	SeverityLow  Severity = "low"
	SeverityHigh Severity = "high"
)

type Unrelated struct {
	Name string
}

// Item is a stored record.
type Item struct {
	ID uuid.UUID `gorm:"primaryKey" json:"id" yaml:"id"`
	// Labels are free-form.
	Labels    pq.StringArray `gorm:"type:[]text" json:"labels,omitempty" faker:"-"`
	Severity  Severity       `json:"severity"`
	Internal  string         `gorm:"-"`
	Functions Unrelated      `json:"-"`
	CreatedAt *time.Time     `json:"created_at"`
	cache     map[string]any
}

func (i Item) BeforeCreate(tx *gorm.DB) error { return nil }
