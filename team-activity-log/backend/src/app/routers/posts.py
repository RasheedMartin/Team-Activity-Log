from datetime import datetime, timedelta

from fastapi import APIRouter

from ..models import Posts

router = APIRouter()

def mins_ago(mins):
    return (datetime.now() - timedelta(minutes=mins))

@router.get("/posts", response_model=list[Posts])
async def get_posts():
    return INITIAL_POSTS



INITIAL_POSTS = [
    {
        "id": 1,
        "userId": 1,
        "timestamp": mins_ago(14),
        "tags": ["frontend", "design"],
        "blocks": [
            {
                "type": "text",
                "html": "<p>Finished migrating the dashboard components to the new design system. All tokens are now sourced from the central theme — no more hardcoded hex values scattered across files.</p>",
                "position": 0
            },
            {
                "type": "text",
                "html": "<p>Also added <strong>Storybook stories</strong> for Button, Input, and Card. Next: data table responsiveness on mobile.</p>",
                "position": 1

            },
        ],
        "title": "Dashboard Migration",
        "comments": [
            {
                "id": 1,
                "userId": 2,
                "postId": 1,
                "parentId": None,
                "text": "Great work! The Storybook coverage will save us so much time.",
                "time": mins_ago(10),
                "replies": [
                    {
                        "id": 2,
                        "userId": 3,
                        "postId": 1,
                        "parentId": 1,
                        "text": "Totally agree — especially for the design handoff review.",
                        "time": mins_ago(8),
                        "replies": [
                            {
                                "id": 3,
                                "userId": 1,
                                "postId": 1,
                                "parentId": 2,
                                "text": "Thanks both! I'll ping when the table branch is ready for review.",
                                "time": mins_ago(6),
                                "replies": [],
                            }
                        ],
                    }
                ],
            },
            {
                "id": 4,
                "userId": 5,
                "text": "Should we add this to the sprint review deck?",
                "time": mins_ago(9),
                "postId": 1,
                "parentId": None,
                "replies": [
                    {
                        "id": 5,
                        "userId": 1,
                        "postId": 1,
                        "parentId": 4,
                        "text": "Yes! I'll add a screenshot. Priya can you send the Figma link?",
                        "time": mins_ago(7),
                        "replies": [
                            {
                                "id": 6,
                                "userId": 3,
                                "postId": 1,
                                "parentId": 5,
                                "text": "On it — sharing in Slack now.",
                                "time": mins_ago(5),
                                "replies": [],
                            }
                        ],
                    }
                ],
            },
        ],
    },
    {
        "id": 2,
        "userId": 4,
        "timestamp": mins_ago(47),
        "tags": ["infra", "bug", "urgent"],
        "title": "Production Incident",
        "blocks": [
            {
                "type": "text",
                "html": "<p>Production incident <strong>resolved</strong>. Root cause: memory leak in the background job worker. Under high concurrency the pool wasn't releasing connections.</p>",
                "position": 0

            },
            {
                "type": "text",
                "html": "<p>Fix deployed @ 14:32 UTC. Added <code>pool_saturation</code> alert to Datadog.</p>",
                "position": 1

            },
        ],
        "comments": [
            {
                "id": 7,
                "userId": 5,
                "postId": 2,
                "parentId": None,
                "text": "Thanks Tom, adding to the postmortem doc.",
                "time": mins_ago(40),
                "replies": [
                    {
                        "id": 8,
                        "userId": 4,
                        "postId": 2,
                        "parentId": 7,
                        "text": "I'll write up the full RCA by EOD.",
                        "time": mins_ago(35),
                        "replies": [],
                    }
                ],
            },
            {
                "id": 9,
                "userId": 2,
                "postId": 2,
                "parentId": None,
                "text": "Should we also add a circuit breaker for the export queue?",
                "time": mins_ago(38),
                "replies": [
                    {
                        "id": 10,
                        "userId": 4,
                        "postId": 2,
                        "parentId": 9,
                        "text": "Yes, filed it as a follow-up ticket #4821.",
                        "time": mins_ago(32),
                        "replies": [
                            {
                                "id": 11,
                                "userId": 2,
                                "postId": 2,
                                "parentId": 10,
                                "text": "Assigned myself.",
                                "time": mins_ago(28),
                                "replies": [],
                            }
                        ],
                    }
                ],
            },
        ],
    },
    {
        "id": 3,
        "userId": 3,
        "timestamp": mins_ago(120),
        "tags": ["design", "feature"],
        "title": "",
        "blocks": [
            {
                "type": "text",
                "html": "<p>Shared new wireframes for the onboarding flow redesign in Figma. Key changes:</p><ul><li>Reduced steps from 7 → 4</li><li>Progressive disclosure for advanced settings</li><li>Inline help tooltips replacing the sidebar</li><li>Mobile-first layout from scratch</li></ul>",
                "position": 0

            },
        ],
        "comments": [
            {
                "id": 12,
                "userId": 1,
                "postId": 3,
                "parentId": None,
                "text": "Love the reduction to 4 steps. The old flow was brutal.",
                "time": mins_ago(115),
                "replies": [
                    {
                        "id": 13,
                        "userId": 3,
                        "postId": 3,
                        "parentId": 12,
                        "text": "Right? Drop-off at step 3 was ~40% — this should fix it.",
                        "time": mins_ago(110),
                        "replies": [],
                    }
                ],
            }
        ],
    },
]
