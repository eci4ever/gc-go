package email

import (
	"context"
	"fmt"
	"html"

	"github.com/resend/resend-go/v3"
)

type ResendSender struct {
	client *resend.Client
	from   string
}

func NewResendSender(apiKey, from string) *ResendSender {
	return &ResendSender{
		client: resend.NewClient(apiKey),
		from:   from,
	}
}

func (s *ResendSender) SendVerification(
	ctx context.Context,
	to string,
	name string,
	verificationURL string,
) error {
	request := &resend.SendEmailRequest{
		From:    s.from,
		To:      []string{to},
		Subject: "Verify your GC Go email",
		Text: fmt.Sprintf(
			"Hi %s,\n\nVerify your email address by opening this link:\n%s\n\nThis link expires in 30 minutes. If you did not create this account, you can ignore this email.",
			name,
			verificationURL,
		),
		Html: fmt.Sprintf(
			`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#18181b">
				<h1 style="font-size:22px">Verify your email</h1>
				<p>Hi %s,</p>
				<p>Confirm that this email belongs to you. This link expires in 30 minutes.</p>
				<p style="margin:28px 0"><a href="%s" style="background:#18181b;color:#fff;padding:12px 18px;text-decoration:none">Verify email</a></p>
				<p style="font-size:13px;color:#71717a">If you did not create this account, you can ignore this email.</p>
			</div>`,
			html.EscapeString(name),
			html.EscapeString(verificationURL),
		),
	}

	_, err := s.client.Emails.SendWithContext(ctx, request)
	return err
}
