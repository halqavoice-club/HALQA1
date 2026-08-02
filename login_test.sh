#!/bin/sh
IP="192.168.100.147"
CODE=$(curl -s --connect-timeout 5 -o /dev/null -w "%{http_code}" http://$IP:5000/health)
echo "Health: HTTP $CODE"
RESULT=$(curl -s --connect-timeout 10 -X POST -H "Content-Type: application/json" --data-raw '{"email":"superadmin@halqa.com","password":"Admin@2024"}' http://$IP:5000/api/v1/auth/login)
SUCCESS=$(echo $RESULT | grep -o '"success":true')
TOKEN_LEN=$(echo $RESULT | grep -o '"accessToken":"[^"]*"' | wc -c)
echo "Login success: $SUCCESS  token_len: $TOKEN_LEN"
