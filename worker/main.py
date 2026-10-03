"""Durable PDF worker: commit side effects before acknowledging transport."""

import json
import os
import time
import pika
import psycopg
from pdf import render_pdf

connection = pika.BlockingConnection(pika.URLParameters(os.environ["AMQP_URL"]))
channel = connection.channel()
for name in ("render", "dead", "completed"):
    channel.queue_declare(queue=name, durable=True)
channel.basic_qos(prefetch_count=1)


def receive(ch, method, properties, body):
    invoice = json.loads(body)["id"]
    crash = False
    with psycopg.connect(os.environ["DATABASE_URL"]) as db:
        with db.cursor() as cur:
            cur.execute(
                "SELECT customer,amount,stage,attempts,fault FROM jobs WHERE id=%s FOR UPDATE",
                (invoice,),
            )
            row = cur.fetchone()
            if not row or row[2] in ("rendered", "delivered", "dead"):
                if row:
                    cur.execute(
                        "INSERT INTO events(job_id,message) VALUES(%s,%s)",
                        (
                            invoice,
                            "Duplicate or stale render message ignored by durable checkpoint",
                        ),
                    )
                    db.commit()
                ch.basic_ack(method.delivery_tag)
                return
            customer, amount, stage, attempts, fault = row
            if fault == "outage":
                attempts += 1
                target = "dead" if attempts >= 3 else "render"
                cur.execute(
                    "UPDATE jobs SET attempts=%s,stage=%s WHERE id=%s",
                    (attempts, "dead" if target == "dead" else "validated", invoice),
                )
                cur.execute(
                    "INSERT INTO events(job_id,message) VALUES(%s,%s)",
                    (
                        invoice,
                        f"Renderer unavailable · attempt {attempts}/3"
                        + (" → dead-letter queue" if target == "dead" else ""),
                    ),
                )
                cur.execute(
                    "INSERT INTO outbox(queue,payload) VALUES(%s,%s)",
                    (target, json.dumps({"id": invoice})),
                )
            else:
                try:
                    render_pdf(invoice, customer, amount)
                except Exception as error:
                    attempts += 1
                    target = "dead" if attempts >= 3 else "render"
                    cur.execute(
                        "UPDATE jobs SET attempts=%s,stage=%s WHERE id=%s",
                        (
                            attempts,
                            "dead" if target == "dead" else "validated",
                            invoice,
                        ),
                    )
                    cur.execute(
                        "INSERT INTO events(job_id,message) VALUES(%s,%s)",
                        (
                            invoice,
                            f"PDF generation failed ({type(error).__name__}) · attempt {attempts}/3",
                        ),
                    )
                    cur.execute(
                        "INSERT INTO outbox(queue,payload) VALUES(%s,%s)",
                        (target, json.dumps({"id": invoice})),
                    )
                else:
                    if fault == "crash" and attempts == 0:
                        cur.execute(
                            "UPDATE jobs SET attempts=1 WHERE id=%s", (invoice,)
                        )
                        cur.execute(
                            "INSERT INTO events(job_id,message) VALUES(%s,%s)",
                            (
                                invoice,
                                "Worker crash after PDF write; redelivery will reuse output",
                            ),
                        )
                        crash = True
                    else:
                        cur.execute(
                            "UPDATE jobs SET stage='rendered' WHERE id=%s", (invoice,)
                        )
                        cur.execute(
                            "INSERT INTO events(job_id,message) VALUES(%s,%s)",
                            (
                                invoice,
                                "PDF rendered · stable output reused on redelivery",
                            ),
                        )
                        cur.execute(
                            "INSERT INTO outbox(queue,payload) VALUES('completed',%s)",
                            (json.dumps({"id": invoice}),),
                        )
    if crash:
        os._exit(
            17
        )  # Compose restarts worker; RabbitMQ requeues unacknowledged message.
    ch.basic_ack(method.delivery_tag)
    time.sleep(0.25)


channel.basic_consume(queue="render", on_message_callback=receive)
channel.start_consuming()
