const { Color } = require("@skeldjs/client");
const skeldjs = require("@skeldjs/client");
const protocol = require("@skeldjs/protocol");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const client = new skeldjs.SkeldjsClient("2021.6.30", { attemptAuth: false });

console.log("-- tutorial scene method (fixed)")

const [ , , connectRegion, gameCode ] = process.argv;

(async () => {
    console.log("connecting..");
    await client.connect(connectRegion, "weakeyes", 22023);
    
    console.log("joining..");
    await client.joinGame(gameCode);
    
    console.log("sending scene change..");
    await client.send(
        new protocol.ReliablePacket(
            client.getNextNonce(),
            [
                new protocol.GameDataMessage(
                    client.code,
                    [
                        new protocol.SceneChangeMessage(client.clientid, "Tutorial")
                    ]
                )
            ]
        )
    );

    await sleep(1500);
    
    console.log("sending set color..");
    for (const [ , player ] of client.players) {
        await client.send(
            new protocol.ReliablePacket(
                client.getNextNonce(),
                [
                    new protocol.GameDataMessage(
                        client.code,
                        [
                            new protocol.RpcMessage(
                                player.control.netid,
                                new protocol.SetColorMessage(
                                    Color.Black
                                )
                            )
                        ]
                    )
                ]
            )
        );
    }
})();